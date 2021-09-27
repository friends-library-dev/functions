import { APIGatewayEvent } from 'aws-lambda';
import useragent from 'express-useragent';
import isbot from 'isbot';
import log from '@friends-library/slack';
import Responder from '../lib/Responder';
import { getLocationData, locationSummary, mapUrl } from '../lib/location';
import { deviceSummary } from '../lib/device';

export default async function appDownload(
  { path, headers }: APIGatewayEvent,
  respond: Responder,
): Promise<void> {
  const [lang = ``, platform = ``] = path.replace(/.*\/app\/download\//, ``).split(`/`);
  if (![`en`, `es`].includes(lang) || ![`ios`, `android`].includes(platform)) {
    log.error(`Invalid app download path: ${path}`);
    respond.clientError();
  }
  let url = ``;
  if (platform === `ios`) {
    url = `https://apps.apple.com/us/app/friends-library/id${
      lang === `en` ? `1537124207` : `1538800203`
    }`;
  } else {
    url = `https://play.google.com/store/apps/details?id=com.friendslibrary.FriendsLibrary.${lang}.release`;
  }

  respond.redirect(url, 302);

  const userAgent = headers[`user-agent`] || ``;
  const parsedUserAgent = useragent.parse(userAgent);
  if (parsedUserAgent.isBot || isbot(userAgent)) {
    log.debug(`Bot APP download: \`${userAgent}\``);
    return;
  }

  sendSlack(
    lang === `en` ? `english` : `spanish`,
    platform === `ios` ? `ios` : `android`,
    parsedUserAgent,
    headers,
  );
}

async function sendSlack(
  language: 'english' | 'spanish',
  platform: 'ios' | 'android',
  ua: useragent.UserAgent,
  headers: { [key: string]: string },
): Promise<void> {
  const location = await getLocationData(headers[`client-ip`]);

  let where = ``;
  if (location.city) {
    const url = mapUrl(location);
    const appendMap = url ? ` ${url}` : ``;
    where = `, location: \`${locationSummary(location)}\`${appendMap}`;
  }

  log.download(
    `${platform} *App* Download: (${language}), device: \`${deviceSummary(ua)}\`${where}`,
  );
}
