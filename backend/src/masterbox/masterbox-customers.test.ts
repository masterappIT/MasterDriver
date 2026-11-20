import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../config';
import type { PrismaService } from '../prisma.service';
import { MASTERBOX_API, MASTERBOX_CUSTOMER_FIELDS, MasterBoxCustomers, customerBody, type DriverForMasterBox } from './masterbox-customers';

const driver: DriverForMasterBox = {
  id: 'user1',
  countryCode: '+852',
  phone: '91234567',
  locale: 'zh-Hant',
  profile: {
    name: ' 陳大文 ',
    hkPlate: 'AB1234',
    macauPlate: '',
    mainlandPlate: '粵Z1234港',
    vehicleType: '埃爾法',
    hkMacauPhone: '+852 91234567',
    mainlandPhone: null,
  },
  profilePage: { code: 'abcd1234', published: true, blockedAt: null },
};
const WEB = 'https://web.test';

test('a driver is sent with their name, sign-in number, 司機, language and the 客戶欄位; empty fields as null', () => {
  assert.deepEqual(customerBody(driver, WEB), {
    name: '陳大文',
    phone: '+85291234567',
    type: '司機',
    locale: 'zh-Hant',
    attributes: {
      hk_plate: 'AB1234',
      macau_plate: null,
      mainland_plate: '粵Z1234港',
      vehicle_type: '埃爾法',
      hk_macau_phone: '+852 91234567',
      mainland_phone: null,
      card_url: 'https://web.test/p/abcd1234',
    },
  });
});

test('every 客戶欄位 sent is one MasterBox is told to define', () => {
  assert.deepEqual(Object.keys(customerBody(driver, WEB).attributes).sort(), Object.keys(MASTERBOX_CUSTOMER_FIELDS).sort());
});

test('before the profile is filled there is no name, and no 名片連結 without a 名片頁', () => {
  const body = customerBody({ ...driver, profile: null, locale: 'xx', profilePage: null }, WEB);
  assert.equal('name' in body, false);
  assert.equal('locale' in body, false);
  assert.equal(body.attributes.card_url, null);
  assert.equal(body.attributes.hk_plate, null);
});

test('the 名片連結 is sent only while passengers can open the page: not unpublished, not taken down', () => {
  const unpublished = customerBody({ ...driver, profilePage: { code: 'abcd1234', published: false, blockedAt: null } }, WEB);
  assert.equal(unpublished.attributes.card_url, null);
  const blocked = customerBody({ ...driver, profilePage: { code: 'abcd1234', published: true, blockedAt: new Date() } }, WEB);
  assert.equal(blocked.attributes.card_url, null);
});

interface Sent {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: unknown;
}

function setup(env: Record<string, string>, answers: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const sent: Sent[] = [];
  const prisma = { user: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === driver.id ? driver : null) } };
  const masterbox = new MasterBoxCustomers(prisma as unknown as PrismaService, loadConfig(env));
  masterbox.fetcher = async (input, init) => {
    sent.push({
      url: String(input),
      method: init?.method,
      headers: init?.headers as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const answer = answers.shift() ?? { status: 200 };
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status, headers: answer.headers });
  };
  return { masterbox, sent };
}

const keys = { MASTERBOX_APP_ID: 'app_1', MASTERBOX_API_KEY: 'key_1' };

test('nothing is sent without the App ID and API key', async () => {
  const { masterbox, sent } = setup({ MASTERBOX_APP_ID: 'app_1' }, []);
  assert.equal(masterbox.enabled, false);
  assert.equal(await masterbox.syncNow(driver.id), 'skipped');
  assert.equal(await masterbox.remove(driver.id), 'skipped');
  assert.equal(sent.length, 0);
});

test('a driver is put to /customers/{id} with the key', async () => {
  const { masterbox, sent } = setup(keys, [{ status: 201 }]);
  assert.equal(await masterbox.syncNow(driver.id), 'ok');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, `${MASTERBOX_API}/customers/user1`);
  assert.equal(sent[0].method, 'PUT');
  assert.equal(sent[0].headers['X-App-Id'], 'app_1');
  assert.equal(sent[0].headers['X-Api-Key'], 'key_1');
  assert.deepEqual(sent[0].body, customerBody(driver, loadConfig(keys).publicBaseUrl));
});

test('a refused update is a failure, not an error; a driver gone meanwhile is skipped', async () => {
  const { masterbox, sent } = setup(keys, [{ status: 400, body: { error: { code: 'invalid_request', message: '客戶欄位 hk_plate 沒有定義' } } }]);
  assert.equal(await masterbox.syncNow(driver.id), 'failed');
  assert.equal(await masterbox.syncNow('nobody'), 'skipped');
  assert.equal(sent.length, 1);
});

test('told to slow down, it waits as long as asked and tries once more', async () => {
  const { masterbox, sent } = setup(keys, [{ status: 429, headers: { 'Retry-After': '0.01' } }, { status: 200 }]);
  assert.equal(await masterbox.syncNow(driver.id), 'ok');
  assert.equal(sent.length, 2);
});

test('a deleted account deletes its customer; one MasterBox never had counts as removed', async () => {
  const { masterbox, sent } = setup(keys, [{ status: 200 }, { status: 404 }, { status: 403 }]);
  assert.equal(await masterbox.remove('user1'), 'removed');
  assert.equal(sent[0].method, 'DELETE');
  assert.equal(sent[0].url, `${MASTERBOX_API}/customers/user1`);
  assert.equal(await masterbox.remove('user2'), 'removed');
  assert.equal(await masterbox.remove('user3'), 'failed', 'the key is not an admin\'s');
});

test('a network failure is a failure', async () => {
  const { masterbox } = setup(keys, []);
  masterbox.fetcher = async () => {
    throw new Error('connect ECONNREFUSED');
  };
  assert.equal(await masterbox.syncNow(driver.id), 'failed');
  assert.equal(await masterbox.remove(driver.id), 'failed');
});
