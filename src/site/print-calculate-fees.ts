import { APIGatewayEvent } from 'aws-lambda';
import { requireEnv, PrintSize } from '@friends-library/types';
import fetch from 'node-fetch';
import validateJson from '../lib/validate-json';
import Responder from '../lib/Responder';
import log from '../lib/log';
import { feeOffset } from '../lib/stripe';
import { getAuthToken, podPackageId, ShippingLevel, SHIPPING_LEVELS } from '../lib/lulu';

export default async function calculatePrintOrderFees(
  { body }: APIGatewayEvent,
  respond: Responder,
): Promise<void> {
  const data = validateJson<typeof schema.example>(body, schema);
  if (data instanceof Error) {
    log.error('invalid body for /print/calculate-fees', body);
    return respond.json({ msg: data.message }, 400);
  }

  let token = '';
  try {
    token = await getAuthToken();
  } catch (error) {
    respond.json({ msg: 'error_acquiring_oauth_token' }, 500);
    return;
  }

  const cheapest = await calculateCheapest(data, token);
  if (!cheapest) {
    respond.json({ msg: 'shipping_not_possible' }, 500);
    return;
  }

  respond.json(cheapest);
}

/**
 * Not all shipping types are available to all addresses,
 * not even the lowest `MAIL` type, so we need to request
 * all possible shipping types, then filter out the ones that
 * aren't possible for a given address, then choose the cheapest
 */
async function calculateCheapest(
  data: typeof schema.example,
  token: string,
): Promise<null | {
  shippingLevel: ShippingLevel;
  shipping: number;
  tax: number;
  ccFee: number;
}> {
  const results = await Promise.all(
    SHIPPING_LEVELS.map(level => calculateForType(data, token, level)),
  );

  const [cheapest] = results
    .filter(({ statusCode }) => statusCode === 201)
    .sort(({ json: a }, { json: b }) =>
      Number(a.total_cost_incl_tax) < Number(b.total_cost_incl_tax) ? -1 : 1,
    );

  if (!cheapest) {
    return null;
  }

  return {
    shippingLevel: cheapest.shippingLevel,
    shipping: Number(cheapest.json.shipping_cost.total_cost_excl_tax) * 100,
    tax: Number(cheapest.json.total_tax) * 100,
    ccFee: feeOffset(Number(cheapest.json.shipping_cost.total_cost_incl_tax) * 100),
  };
}

async function calculateForType(
  data: typeof schema.example,
  token: string,
  shippingLevel: ShippingLevel,
): Promise<{
  statusCode: number;
  json: typeof luluResponse;
  shippingLevel: ShippingLevel;
}> {
  const { LULU_API_ENDPOINT } = requireEnv('LULU_API_ENDPOINT');
  const res = await fetch(`${LULU_API_ENDPOINT}/print-job-cost-calculations/`, {
    method: 'POST',
    headers: {
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      line_items: data.items.map(item => ({
        page_count: item.pages,
        quantity: item.quantity,
        pod_package_id: podPackageId(item.printSize, item.pages),
      })),
      shipping_address: {
        name: data.address.name,
        street1: data.address.street,
        country_code: data.address.country,
        city: data.address.city,
        state_code: data.address.state,
        postcode: data.address.zip,
      },
      shipping_option: shippingLevel,
    }),
  });
  const json = await res.json();
  return { statusCode: res.status, json, shippingLevel };
}

export const schema = {
  properties: {
    address: { $ref: '/lulu-address' },
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          pages: { $ref: '/pages' },
          printSize: { $ref: '/print-size' },
          quantity: { $ref: '/book-qty' },
        },
        required: ['pages', 'printSize', 'quantity'],
      },
    },
  },
  required: ['address', 'items'],
  example: {
    address: {
      name: 'Jared Henderson',
      street: '123 Mulberry Ln.',
      city: 'Wadsworth',
      state: 'OH',
      zip: '44281',
      country: 'US',
    },
    items: [
      {
        pages: 178,
        printSize: 'm' as PrintSize,
        quantity: 1,
      },
    ],
  },
};

const luluResponse = {
  line_item_costs: [
    {
      cost_excl_discounts: '4.81',
      total_tax: '0.00',
      tax_rate: '0.000000',
      quantity: 1,
      total_cost_excl_tax: '4.81',
      total_cost_excl_discounts: '4.81',
      total_cost_incl_tax: '4.81',
      discounts: [],
      unit_tier_cost: null,
    },
  ],
  shipping_cost: {
    total_cost_excl_tax: '3.99',
    total_cost_incl_tax: '3.99',
    total_tax: '0.00',
    tax_rate: '0.00',
  },
  total_tax: '0.00',
  total_cost_excl_tax: '8.80',
  total_cost_incl_tax: '8.80',
  total_discount_amount: '0.00',
  currency: 'USD',
};