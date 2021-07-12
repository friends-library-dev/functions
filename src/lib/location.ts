import fetch from 'node-fetch';
import { log } from '@friends-library/slack';
import env from '../lib/env';

export type Location = Record<string, string | number | null>;

export async function getLocationData(ip?: string): Promise<Location> {
  const emptyLocation: Location = { ip: ip || null };
  if (!ip || ip.startsWith(`100.64`)) {
    return emptyLocation;
  }

  try {
    const ipRes = await fetch(
      `https://ipapi.co/${emptyLocation.ip}/json/?key=${env(`LOCATION_API_KEY`)}`,
    );
    const json = await ipRes.json();
    if (typeof json === `object` && !json.error) {
      return {
        ip: nullableLocationProp(`string`, json.ip),
        city: nullableLocationProp(`string`, json.city),
        region: nullableLocationProp(`string`, json.region),
        country: nullableLocationProp(`string`, json.country_name),
        postalCode: nullableLocationProp(`string`, json.postal),
        latitude: nullableLocationProp(`number`, json.latitude),
        longitude: nullableLocationProp(`number`, json.longitude),
      };
    } else if (typeof json === `object` && json.error) {
      log.error(`Location api error`, { json });
    }
  } catch {
    // ¯\_(ツ)_/¯
  }
  return emptyLocation;
}

export function locationSummary(location: Location): string {
  return [location.city, location.region, location.postalCode, location.country]
    .filter(Boolean)
    .join(` / `);
}

export function mapUrl(location: Location): string | null {
  if (!location.latitude || !location.longitude) {
    return null;
  }

  return `https://www.google.com/maps/@${location.latitude},${location.longitude},14z`;
}

function nullableLocationProp(
  type: 'string' | 'number',
  value: any,
): string | number | null {
  if (typeof value !== `string` && typeof value !== `number`) {
    return null;
  }

  if (typeof value !== type) {
    return null;
  }

  // some IPs are restricted with a `"Sign up to access"` value
  if (typeof value === `string` && value.match(/sign up/i)) {
    return null;
  }

  return value;
}
