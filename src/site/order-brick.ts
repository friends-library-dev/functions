import { APIGatewayEvent } from 'aws-lambda';
import log from '@friends-library/slack';
import { Client as DbClient } from '@friends-library/db';
import stripeClient from '../lib/stripe';
import Responder from '../lib/Responder';
import env from '../lib/env';

export default async function brickOrder(
  { body }: APIGatewayEvent,
  respond: Responder,
): Promise<void> {
  try {
    var data = JSON.parse(body || ``);
  } catch (error) {
    log.error(`Unparseable JSON body for /orders/brick`, { body: body, error });
    return;
  }

  if (data.paymentIntentId) {
    refundOrCancelPayment(data.paymentIntentId);
  }

  if (data.orderId) {
    setOrderStatusBricked(data.orderId);
  }

  log.error(`*Bricked Order*`, { data });
  respond.noContent();
}

async function setOrderStatusBricked(orderId: string): Promise<void> {
  const db = new DbClient(env(`FLP_API_ENDPOINT`), env(`FLP_API_ORDERS_TOKEN`));
  const findResult = await db.orders.findById(orderId);
  if (!findResult.success) {
    log.error(`Unable to find order ${orderId} to set printJobStatus: bricked`);
    return;
  }

  const order = findResult.value;
  const updateResult = await db.orders.update({
    id: order.id,
    printJobStatus: `bricked`,
  });
  if (!updateResult.success) {
    log.error(`Failed to update order ${orderId} to printJobStatus: bricked`);
    return;
  }

  log.error(`Updated order ${orderId} to printJobStatus: bricked`);
}

async function refundOrCancelPayment(paymentIntentId: string): Promise<void> {
  const client = stripeClient();
  const reqOpts = { maxNetworkRetries: 5 };

  try {
    const refund = await client.refunds.create(
      { payment_intent: paymentIntentId },
      reqOpts,
    );
    log.error(`Created refund ${refund.id} for bricked order`);
  } catch (error) {
    log.error(`Error creating refund for bricked order`, {
      error: error instanceof Error ? error.message : `unknown error`,
    });
  }

  try {
    await client.paymentIntents.cancel(paymentIntentId, reqOpts);
    log.error(`Canceled payment intent ${paymentIntentId} for bricked order`);
  } catch (error) {
    // you can only cancel PI's in certain states, which I think we should never be in
    // but this is here just for a safeguard, so this error is "expected"
    log.error(`Error cancelling payment intent (expected)`, {
      error: error instanceof Error ? error.message : `unknown error`,
    });
  }
}
