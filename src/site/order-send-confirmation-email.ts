import { APIGatewayEvent } from 'aws-lambda';
import { checkoutErrors as Err } from '@friends-library/types';
import mailer from '@sendgrid/mail';
import log from '@friends-library/slack';
import { Client as DbClient } from '@friends-library/db';
import env from '../lib/env';
import Responder from '../lib/Responder';
import { orderConfirmationEmail, emailFrom } from '../lib/email';

export default async function sendOrderConfirmationEmail(
  { path }: APIGatewayEvent,
  respond: Responder,
): Promise<void> {
  const pathMatch = path.match(/\/orders\/([a-z0-9-]+)\/confirmation-email$/);
  if (!pathMatch) {
    log.error(`invalid send order confirmation email path: ${path}`);
    return respond.json({ msg: Err.INVALID_SEND_ORDER_CONFIRMATION_EMAIL_URL }, 400);
  }

  const [, orderId = ``] = pathMatch;
  const db = new DbClient(env(`FLP_API_ENDPOINT`), env(`FLP_API_ORDERS_TOKEN`));
  const findResult = await db.orders.findById(orderId);

  if (!findResult.success) {
    log.error(`order ${orderId} not found`, { error: findResult.error });
    return respond.json({ msg: Err.FLP_ORDER_NOT_FOUND }, 404);
  }

  const order = findResult.value;
  try {
    log.order(`*Order submitted*`, {
      order: {
        name: order.address.name,
        email: order.email,
        items: order.items,
        address: order.address,
      },
    });
  } catch (error) {
    log.error(`Error sending order submitted slack`, { error, order });
  }

  if (order.email === `integration@test.com`) {
    log.info(`Not sending confirmation email for integration test.`);
    respond.noContent();
    return;
  }

  try {
    mailer.setApiKey(env(`SENDGRID_API_KEY`));
    const [res] = await mailer.send({
      ...orderConfirmationEmail(order),
      to: order.email,
      from: emailFrom(order.lang),
      mailSettings: {
        sandboxMode: {
          enable: process.env.NODE_ENV === `development`,
        },
      },
    });

    if (res.statusCode > 202) {
      log.error(`Unexpected response sending order confirmation email`, {
        response: res.toJSON(),
        order,
      });
      return respond.json({ msg: Err.ERROR_SENDING_EMAIL }, 500);
    }
  } catch (error) {
    log.error(`Error sending order confirmation email`, { error, order });
    return respond.json({ msg: Err.ERROR_SENDING_EMAIL }, 500);
  }

  log.info(`Successfully sent confirmation email for order: ${order.id}`);
  respond.noContent();
}
