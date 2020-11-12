import appDownload from '../app-download';
import { invokeCb } from './invoke';

jest.mock(`@friends-library/slack`);

describe(`appDownload()`, () => {
  beforeEach(() => jest.clearAllMocks());

  it(`invalid path responds with client error`, async () => {
    const event = {
      path: `/site/app/download/en/blackberry`,
      headers: {},
    };
    const { err, res } = await invokeCb(appDownload, event);
    expect(err).toBeNull();
    expect(res.statusCode).toBe(400);
  });

  const cases: [string, string][] = [
    [
      `/site/app/download/en/ios`,
      `https://apps.apple.com/us/app/friends-library/id1537124207`,
    ],
    [
      `/site/app/download/es/ios`,
      `https://apps.apple.com/us/app/friends-library/id1538800203`,
    ],
    [
      `/site/app/download/en/android`,
      `https://play.google.com/store/apps/details?id=com.friendslibrary.FriendsLibrary.en.release`,
    ],
    [
      `/site/app/download/es/android`,
      `https://play.google.com/store/apps/details?id=com.friendslibrary.FriendsLibrary.es.release`,
    ],
  ];

  test.each(cases)(`log path %s should redir to %s`, async (path, redir) => {
    const { res } = await invokeCb(appDownload, { path, headers: {} });
    expect(res.headers!.location).toBe(redir);
  });
});
