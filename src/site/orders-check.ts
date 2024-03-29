import mailer from '@sendgrid/mail';
import { APIGatewayEvent } from 'aws-lambda';
import { isDefined } from 'x-ts-utils';
import { CheckoutError, checkoutErrors as Err } from '@friends-library/types';
import { LuluAPI } from '@friends-library/lulu';
import log from '@friends-library/slack';
import { Client as DbClient, Order, UpdateOrderInput } from '@friends-library/db';
import env from '../lib/env';
import Responder from '../lib/Responder';
import luluClient from '../lib/lulu';
import { orderShippedEmail, emailFrom } from '../lib/email';

export default async function checkOrders(
  event: APIGatewayEvent,
  respond: Responder,
): Promise<void> {
  const db = new DbClient(env(`FLP_API_ENDPOINT`), env(`FLP_API_ORDERS_TOKEN`));
  const findResult = await db.orders.findByPrintJobStatus(`accepted`);
  if (!findResult.success) {
    log.error(`Error retrieving orders for /orders/check`, { error: findResult.error });
    return respond.json({ msg: Err.ERROR_RETRIEVING_FLP_ORDERS }, 500);
  }

  const orders = findResult.value;
  if (orders.length === 0) {
    log.debug(`No accepted print jobs to process`);
    return respond.json({ msg: `No accepted print jobs to process` });
  }

  const [printJobErr, jobs] = await getPrintJobs(orders);
  if (printJobErr) {
    log.error(`Error fetching print jobs from lulu api`, { error: printJobErr });
    return respond.json({ msg: printJobErr }, 500);
  }

  const updatedOrders: UpdateOrderInput[] = [];
  const recentlyShippedOrders: Order[] = [];

  jobs.forEach((job) => {
    const status = job.status.name;
    if (status === `IN_PRODUCTION`) {
      return;
    }

    const order = orders.find((o) => o.printJobId === job.id);
    if (!order) {
      return;
    }

    switch (status) {
      case `UNPAID`: {
        log.error(`order ${order.id} is unpaid!`);
        break;
      }

      case `REJECTED`:
      case `CANCELED`:
        log.error(`order ${order.id} was ${status}!`);
        order.printJobStatus = status === `REJECTED` ? `rejected` : `canceled`;
        updatedOrders.push({
          id: order.id,
          printJobStatus: status === `REJECTED` ? `rejected` : `canceled`,
        });
        break;

      case `SHIPPED`:
        log.order(`Order ${order.id} shipped`);
        updatedOrders.push({ id: order.id, printJobStatus: `shipped` });
        recentlyShippedOrders.push(order);
        break;
    }
  });

  if (updatedOrders.length) {
    const updateResult = await db.orders.updateAll(updatedOrders);
    if (!updateResult.success) {
      log.error(`error persisting updated orders`, { error: updateResult.error });
      return respond.json(
        { msg: Err.ERROR_UPDATING_FLP_ORDERS, error: updateResult.error },
        500,
      );
    }
  }

  if (recentlyShippedOrders.length) {
    await sendShipmentTrackingEmails(jobs, recentlyShippedOrders);
  }

  const channel =
    updatedOrders.length + recentlyShippedOrders.length > 0 ? `info` : `debug`;
  log[channel](
    `Updated ${updatedOrders.length} orders, and sent ${recentlyShippedOrders.length} tracking emails`,
  );

  respond.json({
    num_updated_orders: updatedOrders.length,
    num_tracking_emails_sent: recentlyShippedOrders.length,
  });
}

async function getPrintJobs(
  orders: Order[],
): Promise<[null | CheckoutError, LuluAPI.PrintJob[]]> {
  const ids = orders.map((o) => o.printJobId).filter(isDefined);
  const [json, status] = await luluClient().listPrintJobs(ids);
  if (status !== 200) {
    log.error(`error retrieving print job data`, { msg: json });
    return [Err.ERROR_RETRIEVING_PRINT_JOB_DATA, []];
  }

  return [null, json.results];
}

async function sendShipmentTrackingEmails(
  jobs: LuluAPI.PrintJob[],
  orders: Order[],
): Promise<void> {
  const shippedJobs = jobs.filter((job) => job.status.name === `SHIPPED`);

  const emails = shippedJobs.map((job) => {
    const order = orders.find((o) => o.printJobId === job.id);
    if (!order) throw new Error(`Matching order not found!`);
    return {
      ...orderShippedEmail(order, trackingUrl(job)),
      to: order.email,
      from: emailFrom(order.lang),
      mailSettings: { sandboxMode: { enable: process.env.NODE_ENV === `development` } },
    };
  });

  try {
    mailer.setApiKey(env(`SENDGRID_API_KEY`));
    const sendResult = await mailer.send(emails);
    // typings are bad, sending multiple emails returns multiple responses, like below
    const responses = sendResult[0] as unknown as [{ statusCode: number } | undefined];
    const failed = responses.filter((r) => r && r.statusCode >= 300);
    if (failed.length) {
      log.error(`bad send shipment tracking email response`, { error: failed });
    }
  } catch (error) {
    log.error(`error sending shipment tracking emails`, { error, emails });
  }
}

function trackingUrl(job: LuluAPI.PrintJob): string | undefined {
  const firstLineItem = job.line_items[0];
  // this is a hair naive, theoretically there could be more than one shipment
  // for a huge order, this just gets the first tracking url, but probably good enough
  return firstLineItem?.tracking_urls ? firstLineItem.tracking_urls[0] : undefined;
}
