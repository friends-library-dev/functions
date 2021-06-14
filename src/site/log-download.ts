import '@friends-library/env/load';
import { APIGatewayEvent } from 'aws-lambda';
import env from '../lib/env';
import {
  isEdition,
  EditionType,
  AudioQuality,
  DownloadFormat,
  DOWNLOAD_FORMATS,
} from '@friends-library/types';
import useragent from 'express-useragent';
import isbot from 'isbot';
import { Client as DbClient, Db } from '@friends-library/db';
import { log } from '@friends-library/slack';
import Responder from '../lib/Responder';
import { deviceSummary } from '../lib/device';
import { getLocationData, locationSummary, mapUrl, Location } from '../lib/location';

async function logDownload(
  { path, headers = {} }: APIGatewayEvent,
  respond: Responder,
): Promise<void> {
  const referrer = headers.referer || ``;
  const pathParts = path.replace(/.*\/log\/download\//, ``).split(`/`);
  const docId = pathParts.shift() || ``;
  const filename = pathParts.pop() || ``;
  const format = (pathParts.pop() || ``) as DownloadFormat;
  const editionPath = pathParts.join(`/`);
  const editionType = (editionPath || ``).split(`/`).pop() as EditionType;
  const cloudPath = `${editionPath}/${filename}`;
  let redirUri = `${env(`CLOUD_STORAGE_BUCKET_URL`)}/${cloudPath}`;

  if (!isEdition(editionType)) {
    respond.clientError(`Bad editionType to /log/download: ${editionType}`);
    return;
  }

  // @ts-ignore @TODO: temp, during app e-reader transition
  if (!DOWNLOAD_FORMATS.includes(format) && format !== `app-ebook`) {
    respond.clientError(`Unknown download format: ${format}`);
    return;
  }

  let audioQuality: AudioQuality | undefined;
  let audioPartNumber: number | undefined;

  if (format === `podcast`) {
    audioQuality = filename.endsWith(`--lq.rss`) ? `LQ` : `HQ`;
    // @TODO this is duplicated in Audio.podcastRelFilepath() :(
    redirUri = `${editionPath.replace(/^(en|es)\//, `/`)}/${
      audioQuality === `LQ` ? `lq/` : ``
    }podcast.rss`;
  }

  if (format === `mp3`) {
    audioQuality = filename.endsWith(`--lq.mp3`) ? `LQ` : `HQ`;
    audioPartNumber = 1;
    filename.replace(/--pt(\d+)(--lq)?\.mp3$/, (_, num) => {
      audioPartNumber = Number(num);
      return ``;
    });
  }

  if (format === `mp3-zip` || format === `m4b`) {
    audioQuality = filename.match(/--lq\.(zip|m4b)$/) ? `LQ` : `HQ`;
  }

  respond.redirect(redirUri, format === `podcast` ? 301 : 302);

  const userAgent = headers[`user-agent`] || ``;
  const parsedUserAgent = useragent.parse(userAgent);
  const isAppUserAgent = userAgent.includes(`FriendsLibrary`);
  if (!isAppUserAgent && (parsedUserAgent.isBot || isbot(userAgent))) {
    log.debug(`Bot download: \`${userAgent}\``);
    return;
  }

  let location: Location = {
    ip: headers[IP_HEADER_KEY] || null,
  };

  // fetch location data for only 5% of podcast requests, to stay within rate limits
  if (location.ip && (format !== `podcast` || Math.random() < 0.05)) {
    location = await getLocationData(headers[IP_HEADER_KEY]);
  }

  const download: Db.Download = {
    documentId: docId,
    edition: editionType,
    format,
    audioQuality,
    audioPartNumber,
    isMobile: parsedUserAgent.isMobile,
    os: parsedUserAgent.os,
    browser: parsedUserAgent.browser,
    platform: parsedUserAgent.platform,
    referrer,
    ...location,
    created: new Date().toISOString(),
    userAgent,
  };

  const db = new DbClient(env(`FAUNA_SERVER_SECRET`));
  const [error] = await db.downloads.create(download);
  if (error) {
    log.error(`error adding download to db`, { error });
  } else {
    log.debug(`Download added to db:`, { download });
  }

  sendSlack(parsedUserAgent, referrer, cloudPath, location, format);
}

export default logDownload;

function sendSlack(
  ua: useragent.UserAgent,
  referrer: string,
  cloudPath: string,
  location: Location,
  format: DownloadFormat | 'app-ebook', // @TODO temp
): void {
  const from = referrer ? `, from url: \`${unUrl(referrer)}\`` : ``;

  let where = ``;
  if (location.city) {
    const url = mapUrl(location);
    const appendMap = url ? ` ${url}` : ``;
    where = `, location: \`${locationSummary(location)}\`${appendMap}`;
  }

  const channel = [`mp3`, `podcast`].includes(format) ? `audio` : `download`;
  log[channel](
    `Download: \`${cloudPath}\`, device: \`${deviceSummary(ua)}\`${from}${where}`,
  );
}

// prevent slack from unfurling urls (even though they are in backticks)
function unUrl(referrer: string): string {
  return referrer.replace(/^https:\/\/www\.([^/]+)/, `[$1]`);
}

// this is the officially blessed header for resolving client IP, per Netlify:
// https://answers.netlify.com/t/is-the-client-ip-header-going-to-be-supported-long-term/11203/2
const IP_HEADER_KEY = `x-nf-client-connection-ip`;
