// MSW server for DirectusClient unit tests. Default handlers cover the
// happy-path Directus surface at http://directus.test; per-test behavior is
// added with server.use(...). Unhandled requests are an error so handler gaps
// fail loudly instead of hanging axios.
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  COLLECTIONS,
  FIELDS_ARTICLES,
  RELATIONS,
  ITEMS_ARTICLES,
  USERS,
  ROLES,
  FILES,
  FLOWS,
  PERMISSIONS,
  SERVER_INFO,
  envelope,
} from './fixtures.js';

export const DIRECTUS_URL = 'http://directus.test';

export const defaultHandlers = [
  http.get(`${DIRECTUS_URL}/server/ping`, () => HttpResponse.json({ data: 'pong' })),
  http.get(`${DIRECTUS_URL}/server/info`, () => HttpResponse.json(envelope(SERVER_INFO))),
  http.get(`${DIRECTUS_URL}/collections`, () => HttpResponse.json(envelope(COLLECTIONS))),
  http.get(`${DIRECTUS_URL}/collections/:name`, ({ params }) =>
    HttpResponse.json(envelope(COLLECTIONS.find((c) => c.collection === params.name) ?? COLLECTIONS[0]))
  ),
  http.get(`${DIRECTUS_URL}/fields`, () => HttpResponse.json(envelope(FIELDS_ARTICLES))),
  http.get(`${DIRECTUS_URL}/fields/:collection`, () => HttpResponse.json(envelope(FIELDS_ARTICLES))),
  http.get(`${DIRECTUS_URL}/relations`, () => HttpResponse.json(envelope(RELATIONS))),
  http.get(`${DIRECTUS_URL}/items/:collection`, () =>
    HttpResponse.json({ data: ITEMS_ARTICLES, meta: { total_count: ITEMS_ARTICLES.length } })
  ),
  http.get(`${DIRECTUS_URL}/items/:collection/:id`, () => HttpResponse.json(envelope(ITEMS_ARTICLES[0]))),
  http.get(`${DIRECTUS_URL}/users`, () => HttpResponse.json(envelope(USERS))),
  http.get(`${DIRECTUS_URL}/users/:id`, () => HttpResponse.json(envelope(USERS[0]))),
  http.get(`${DIRECTUS_URL}/roles`, () => HttpResponse.json(envelope(ROLES))),
  http.get(`${DIRECTUS_URL}/roles/:id`, () => HttpResponse.json(envelope(ROLES[0]))),
  http.get(`${DIRECTUS_URL}/files`, () => HttpResponse.json(envelope(FILES))),
  http.get(`${DIRECTUS_URL}/flows`, () => HttpResponse.json(envelope(FLOWS))),
  http.get(`${DIRECTUS_URL}/permissions`, () => HttpResponse.json(envelope(PERMISSIONS))),
];

export const server = setupServer(...defaultHandlers);

export { http, HttpResponse };
