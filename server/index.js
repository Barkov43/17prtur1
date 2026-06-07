import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const dataDir = path.join(__dirname, 'data');
const storePath = path.join(dataDir, 'store.json');
const aiCredPath = path.join(dataDir, 'ai-cred.json');
const internalPromptPath = path.join(dataDir, 'internal-llm-prompt.md');
const PORT = Number(process.env.PORT || 4173);
const OSRM_URL = String(process.env.OSRM_URL || 'https://router.project-osrm.org').replace(/\/+$/, '');
const GEOCODER_URL = String(process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org').replace(/\/+$/, '');
const geocodeCache = new Map();

const cityCenters = {
  'киров': { lat: 58.6035, lng: 49.6679 },
  'пермь': { lat: 58.0105, lng: 56.2502 }
};

const defaultAiCreds = {
  AI_API_URL: 'https://api.openai.com/v1/chat/completions',
  AI_API_KEY: '',
  AI_API_MODEL: 'gpt-3.5-turbo',
  AI_SYSTEM_PROMPT: ''
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
};

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf-8'));
}

async function writeJson(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function loadAiCreds() {
  let fileCreds = {};
  try {
    fileCreds = await readJson(aiCredPath);
  } catch {
    fileCreds = {};
  }

  const envCreds = Object.fromEntries(
    ['AI_API_URL', 'AI_API_KEY', 'AI_API_MODEL', 'AI_SYSTEM_PROMPT']
      .filter((key) => String(process.env[key] || '').trim())
      .map((key) => [key, process.env[key]])
  );

  return { ...defaultAiCreds, ...fileCreds, ...envCreds };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendError(res, status, message) {
  sendJson(res, status, { message });
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenize(text) {
  return normalize(text)
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function addMinutes(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function minutesBetween(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

function timeToMinutes(time) {
  const [h, m] = String(time || '00:00').split(':').map(Number);
  return h * 60 + m;
}

function validCoordinates(value) {
  return value
    && Number.isFinite(Number(value.lat))
    && Number.isFinite(Number(value.lng));
}

async function resolveMeetingPoint(request) {
  if (validCoordinates(request.meetingCoordinates)) return request;

  const meetingPoint = String(request.meetingPoint || '').trim();
  const cityCenter = cityCenters[normalize(request.city)] || null;
  if (!meetingPoint || meetingPoint === 'по согласованию') {
    return {
      ...request,
      meetingCoordinates: cityCenter,
      meetingGeocoding: {
        provider: 'fallback',
        warning: 'Точный адрес точки сбора не указан, используется центр города.'
      }
    };
  }

  const cityPrefix = new RegExp(`^(?:г(?:ород)?\\.?\\s*)?${escapeRegExp(request.city)}\\s*,?\\s*`, 'iu');
  const addressWithoutCity = meetingPoint.replace(cityPrefix, '').trim();
  const query = `${addressWithoutCity || meetingPoint}, ${request.city}, Россия`;
  const cached = geocodeCache.get(normalize(query));
  if (cached) {
    return { ...request, meetingCoordinates: cached.coordinates, meetingGeocoding: cached.details };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const url = new URL(`${GEOCODER_URL}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'ru');
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept-Language': 'ru',
        'User-Agent': '17prtur-industrial-tour-mvp/1.0 (https://github.com/Barkov43/17prtur1)'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const results = await response.json();
    const match = results?.[0];
    const coordinates = match ? { lat: Number(match.lat), lng: Number(match.lon) } : null;
    if (!validCoordinates(coordinates)) throw new Error('адрес не найден');

    const details = {
      provider: 'nominatim',
      query,
      displayName: match.display_name || meetingPoint
    };
    geocodeCache.set(normalize(query), { coordinates, details });
    return { ...request, meetingCoordinates: coordinates, meetingGeocoding: details };
  } catch (error) {
    return {
      ...request,
      meetingCoordinates: cityCenter,
      meetingGeocoding: {
        provider: 'fallback',
        query,
        warning: `Не удалось найти точку сбора по адресу: ${error.name === 'AbortError' ? 'превышено время ожидания' : error.message}. Используется центр города.`
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

function routeStops(selection, request) {
  const meetingCoordinates = validCoordinates(request.meetingCoordinates)
    ? request.meetingCoordinates
    : cityCenters[normalize(request.city)];
  const stops = [
    { type: 'meeting', name: request.meetingPoint || 'Точка сбора', coordinates: meetingCoordinates }
  ];

  selection.selectedEnterprises.forEach((enterprise, index) => {
    stops.push({ type: 'enterprise', name: enterprise.name, coordinates: enterprise.coordinates });
    if (selection.selectedFood && index === 0 && selection.selectedEnterprises.length > 1) {
      stops.push({ type: 'food', name: selection.selectedFood.name, coordinates: selection.selectedFood.coordinates });
    }
  });

  if (selection.selectedFood && selection.selectedEnterprises.length === 1) {
    stops.push({ type: 'food', name: selection.selectedFood.name, coordinates: selection.selectedFood.coordinates });
  }
  if (selection.selectedAccommodation) {
    stops.push({ type: 'accommodation', name: selection.selectedAccommodation.name, coordinates: selection.selectedAccommodation.coordinates });
  }
  stops.push({ type: 'meeting', name: request.meetingPoint || 'Точка сбора', coordinates: meetingCoordinates });
  return stops;
}

async function buildOsrmRoute(selection, request) {
  const stops = routeStops(selection, request);
  const routableStops = stops.filter((stop) => validCoordinates(stop.coordinates));
  const geocodingWarning = request.meetingGeocoding?.warning || '';
  const fallback = {
    provider: 'fallback',
    points: stops.map((stop) => stop.name),
    stops,
    meetingGeocoding: request.meetingGeocoding || null,
    distanceKm: null,
    durationMinutes: null,
    geometry: null,
    legs: [],
    warning: [
      geocodingWarning,
      routableStops.length < stops.length ? 'Часть объектов не имеет координат.' : ''
    ].filter(Boolean).join(' ')
  };
  if (routableStops.length < 2) return fallback;

  const coordinates = routableStops
    .map((stop) => `${Number(stop.coordinates.lng)},${Number(stop.coordinates.lat)}`)
    .join(';');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch(`${OSRM_URL}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`, {
      signal: controller.signal,
      headers: { 'User-Agent': '17prtur-industrial-tour-mvp/1.0' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const route = data.routes?.[0];
    if (!route) throw new Error(data.message || 'Маршрут не найден');
    return {
      provider: 'osrm',
      points: stops.map((stop) => stop.name),
      stops,
      routedStops: routableStops,
      meetingGeocoding: request.meetingGeocoding || null,
      distanceKm: Math.round((route.distance / 1000) * 10) / 10,
      durationMinutes: Math.max(1, Math.round(route.duration / 60)),
      geometry: route.geometry,
      legs: (route.legs || []).map((leg) => ({
        distanceKm: Math.round((leg.distance / 1000) * 10) / 10,
        durationMinutes: Math.max(1, Math.round(leg.duration / 60))
      })),
      warning: [
        geocodingWarning,
        routableStops.length < stops.length ? 'Объекты без координат не включены в расчёт OSRM.' : ''
      ].filter(Boolean).join(' ')
    };
  } catch (error) {
    return {
      ...fallback,
      warning: `OSRM недоступен: ${error.name === 'AbortError' ? 'превышено время ожидания' : error.message}`
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function loadSystemPrompt(creds) {
  try {
    const prompt = await readFile(internalPromptPath, 'utf-8');
    return prompt.split('# User Prompt')[0].trim() || creds.AI_SYSTEM_PROMPT || '';
  } catch {
    return creds.AI_SYSTEM_PROMPT || '';
  }
}

function resolveChatCompletionsUrl(apiUrl) {
  const value = String(apiUrl || defaultAiCreds.AI_API_URL).trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(value)) return value;
  return `${value}/chat/completions`;
}

function groupLabel(groupType) {
  return {
    school: 'школьники',
    student: 'студенты',
    business: 'бизнес-делегация'
  }[groupType] || groupType;
}

function goalLabel(goal) {
  return {
    career: 'профориентация',
    tasting: 'экскурсия с дегустацией',
    exchange: 'обмен опытом',
    business: 'бизнес-туризм'
  }[goal] || goal;
}

function scoreEnterprise(enterprise, request) {
  const interests = tokenize(`${request.interests || ''} ${goalLabel(request.goal)}`);
  const haystack = tokenize(`${enterprise.name} ${enterprise.industry} ${enterprise.description} ${enterprise.tags.join(' ')}`);
  let score = 0;

  if (isEnterpriseMentioned(enterprise, request)) score += 1000;

  for (const word of interests) {
    if (haystack.includes(word)) score += 12;
  }

  if (request.goal === 'career' && enterprise.tags.includes('профориентация')) score += 24;
  if (request.goal === 'tasting' && enterprise.tags.includes('дегустация')) score += 26;
  if (request.goal === 'business' && enterprise.tags.includes('бизнес-туризм')) score += 30;
  if (request.goal === 'exchange' && enterprise.tags.includes('обмен опытом')) score += 30;

  if (enterprise.isFree) score += 28;
  if (request.groupType === 'school') {
    score += Math.max(0, 1200 - enterprise.prices.school) / 40;
    if (enterprise.tags.includes('школьники')) score += 16;
  }
  if (request.groupType === 'student' && enterprise.tags.includes('студенты')) score += 14;
  if (request.groupType === 'business' && enterprise.tags.includes('бизнес-туризм')) score += 18;

  score += Math.max(0, enterprise.capacity - request.groupSize) / 10;
  return Math.round(score);
}

function enterpriseMentionKeywords(enterprise) {
  const generic = new Set(['завод', 'музей', 'зао', 'ооо', 'ао', 'фабрика', 'производственный', 'холдинг', 'истории']);
  return tokenize(`${enterprise.name} ${enterprise.externalId || ''}`)
    .filter((word) => word.length > 3 && !generic.has(word));
}

function isEnterpriseMentioned(enterprise, request) {
  const interestTokens = tokenize(request.interests || '');
  if (!interestTokens.length) return false;
  return enterpriseMentionKeywords(enterprise).some((word) => interestTokens.includes(word));
}

function getRequestedEnterpriseNotes(store, request) {
  const groupSize = Number(request.groupSize || 0);
  return store.enterprises
    .filter((enterprise) => isEnterpriseMentioned(enterprise, request))
    .map((enterprise) => {
      const reasons = [];
      const format = chooseTourFormat(enterprise, request);
      if (normalize(enterprise.city) !== normalize(request.city)) reasons.push(`город объекта: ${enterprise.city}`);
      if (!enterprise.allowedGroups.includes(request.groupType)) reasons.push(`не подходит для группы "${groupLabel(request.groupType)}"`);
      if (enterprise.capacity < groupSize) reasons.push(`вместимость ${enterprise.capacity} меньше группы ${groupSize}`);
      if ((enterprise.minGroup || 1) > groupSize) reasons.push(`минимальная группа ${enterprise.minGroup}`);
      if (!enterpriseCanStart(enterprise, request, format)) reasons.push(`нет подходящего старта после ${request.startTime || '09:00'}`);
      return reasons.length
        ? `Запрошенный объект "${enterprise.name}" не включён: ${reasons.join(', ')}.`
        : `Запрошенный объект "${enterprise.name}" получил приоритет при подборе.`;
    });
}

function chooseTourFormat(enterprise, request) {
  const formats = Array.isArray(enterprise.tourFormats) && enterprise.tourFormats.length
    ? enterprise.tourFormats
    : [{ name: 'экскурсия', duration_min: enterprise.durationMinutes, price_per_person: enterprise.prices[request.groupType] || 0 }];

  const sorted = [...formats].sort((a, b) => {
    if (request.groupType === 'school') {
      return (a.price_per_person || 0) - (b.price_per_person || 0)
        || (a.duration_min || 0) - (b.duration_min || 0);
    }
    if (request.goal === 'tasting') {
      const aTasting = /дегустац|набор|мастер/i.test(a.name || '');
      const bTasting = /дегустац|набор|мастер/i.test(b.name || '');
      return Number(bTasting) - Number(aTasting)
        || (a.price_per_person || 0) - (b.price_per_person || 0);
    }
    return (a.price_per_person || 0) - (b.price_per_person || 0);
  });
  return sorted[0];
}

function enterpriseCanStart(enterprise, request, format) {
  const requestedStart = request.startTime || '09:00';
  const starts = enterprise.availableStarts || [];
  const start = starts.find((item) => timeToMinutes(item) >= timeToMinutes(requestedStart)) || starts[0] || requestedStart;
  const end = addMinutes(start, format.duration_min || enterprise.durationMinutes || 60);
  return timeToMinutes(start) >= timeToMinutes(enterprise.workStart || '00:00')
    && timeToMinutes(end) <= timeToMinutes(enterprise.workEnd || '23:59');
}

function getCandidates(store, request) {
  const city = normalize(request.city);
  const groupSize = Number(request.groupSize || 0);

  const enterprises = store.enterprises
    .filter((item) => normalize(item.city) === city)
    .filter((item) => item.allowedGroups.includes(request.groupType))
    .filter((item) => item.capacity >= groupSize && (item.minGroup || 1) <= groupSize)
    .map((item) => {
      const selectedFormat = chooseTourFormat(item, request);
      return {
        ...item,
        selectedFormat,
        durationMinutes: selectedFormat.duration_min || item.durationMinutes,
        prices: {
          ...item.prices,
          [request.groupType]: selectedFormat.price_per_person ?? item.prices[request.groupType] ?? 0
        },
        score: scoreEnterprise(item, request)
      };
    })
    .filter((item) => enterpriseCanStart(item, request, item.selectedFormat))
    .sort((a, b) => Number(b.isFree) - Number(a.isFree) || b.score - a.score);

  const foodPlaces = store.foodPlaces
    .filter((item) => normalize(item.city) === city && item.capacity >= groupSize)
    .sort((a, b) => {
      if (request.groupType === 'school') return a.pricePerPerson - b.pricePerPerson;
      if (request.groupType === 'business') return Number(b.tags.includes('делегация')) - Number(a.tags.includes('делегация'));
      return a.pricePerPerson - b.pricePerPerson;
    });

  const accommodations = store.accommodations
    .filter((item) => normalize(item.city) === city && item.capacity >= groupSize)
    .sort((a, b) => {
      if (request.groupType === 'business') return Number(b.tags.includes('бизнес')) - Number(a.tags.includes('бизнес'));
      return a.pricePerPerson - b.pricePerPerson;
    });

  const transports = store.transportCompanies
    .filter((item) => normalize(item.city) === city && item.capacity >= groupSize && (item.capacityMin || 1) <= groupSize)
    .sort((a, b) => a.pricePerHour - b.pricePerHour);

  return { enterprises, foodPlaces, accommodations, transports };
}

function chooseByRules(store, request) {
  const candidates = getCandidates(store, request);
  const requestedNotes = getRequestedEnterpriseNotes(store, request);
  const duration = Number(request.durationHours || 5);
  const maxEnterprises = duration >= 7 ? 3 : duration >= 5 ? 2 : 1;
  const selectedEnterprises = candidates.enterprises.slice(0, maxEnterprises);
  const selectedFood = duration >= 5 || request.overnight ? candidates.foodPlaces[0] : null;
  const selectedAccommodation = request.overnight ? candidates.accommodations[0] : null;
  const selectedTransport = candidates.transports[0] || null;

  return {
    selectedEnterprises,
    selectedFood,
    selectedAccommodation,
    selectedTransport,
    candidates,
    requestedNotes
  };
}

function buildProgram(selection, request, route) {
  const program = [];
  let time = request.startTime || '09:00';
  let routeLegIndex = 0;
  const push = (durationMinutes, title, description) => {
    const end = addMinutes(time, durationMinutes);
    program.push({ time, endTime: end, durationMinutes, title, description });
    time = end;
  };
  const pushTravel = (fallbackMinutes, title, description) => {
    const leg = route?.legs?.[routeLegIndex];
    routeLegIndex += 1;
    const duration = leg?.durationMinutes || fallbackMinutes;
    const distance = leg?.distanceKm ? ` ${leg.distanceKm} км.` : '';
    push(duration, title, `${description}${distance}`);
  };
  const waitForEnterpriseSlot = (enterprise) => {
    const currentMinutes = timeToMinutes(time);
    const availableStart = (enterprise.availableStarts || [])
      .map((slot) => ({ slot, minutes: timeToMinutes(slot) }))
      .find(({ minutes }) => minutes >= currentMinutes);
    if (!availableStart || availableStart.minutes <= currentMinutes) return;
    push(
      availableStart.minutes - currentMinutes,
      'Подготовка к экскурсии',
      `Регистрация группы, инструктаж по безопасности и ожидание подтверждённого старта в ${availableStart.slot}.`
    );
  };

  push(15, 'Сбор группы', `Точка сбора: ${request.meetingPoint || 'по согласованию'}. Группа: ${groupLabel(request.groupType)}, ${request.groupSize} чел.`);

  selection.selectedEnterprises.forEach((enterprise, index) => {
    pushTravel(index === 0 ? 30 : 20, 'Переезд', `Маршрут до объекта: ${enterprise.name}, ${enterprise.address}.`);
    waitForEnterpriseSlot(enterprise);
    const formatName = enterprise.selectedFormat?.name || 'экскурсия';
    push(enterprise.durationMinutes, enterprise.name, `${enterprise.industry}. Формат: ${formatName}. ${enterprise.description}`);

    const shouldEat = selection.selectedFood && index === 0 && selection.selectedEnterprises.length > 1;
    if (shouldEat) {
      pushTravel(15, 'Переезд к питанию', `${selection.selectedFood.name}, ${selection.selectedFood.address}.`);
      push(selection.selectedFood.minDurationMinutes, 'Питание группы', `${selection.selectedFood.type}, ориентир ${selection.selectedFood.pricePerPerson} ₽ на человека.`);
    }
  });

  if (selection.selectedFood && selection.selectedEnterprises.length === 1) {
    pushTravel(15, 'Переезд к питанию', `${selection.selectedFood.name}, ${selection.selectedFood.address}.`);
    push(selection.selectedFood.minDurationMinutes, 'Питание группы', `${selection.selectedFood.type}, ориентир ${selection.selectedFood.pricePerPerson} ₽ на человека.`);
  }

  if (selection.selectedAccommodation) {
    pushTravel(25, 'Переезд к размещению', `${selection.selectedAccommodation.name}, ${selection.selectedAccommodation.address}.`);
    push(25, 'Размещение', `${selection.selectedAccommodation.name}, ${selection.selectedAccommodation.address}. Ночёвка включена в предложение.`);
  }

  pushTravel(30, 'Возвращение', 'Возвращение к точке сбора, подведение итогов поездки.');
  return program;
}

function calculatePricing(selection, request) {
  const groupSize = Number(request.groupSize || 0);
  const duration = Number(request.durationHours || 5);
  const enterpriseTotal = selection.selectedEnterprises.reduce(
    (sum, item) => sum + Number(item.prices[request.groupType] || 0) * groupSize,
    0
  );
  const foodTotal = selection.selectedFood ? selection.selectedFood.pricePerPerson * groupSize : 0;
  const accommodationTotal = selection.selectedAccommodation ? selection.selectedAccommodation.pricePerPerson * groupSize : 0;
  const transportHours = Math.max(selection.selectedTransport?.minHours || 0, Math.ceil(duration + (request.overnight ? 2 : 0)));
  const transportTotal = selection.selectedTransport ? transportHours * selection.selectedTransport.pricePerHour : 0;
  const serviceFee = Math.round((enterpriseTotal + foodTotal + accommodationTotal + transportTotal) * 0.08);
  const total = enterpriseTotal + foodTotal + accommodationTotal + transportTotal + serviceFee;

  return {
    enterpriseTotal,
    foodTotal,
    accommodationTotal,
    transportTotal,
    serviceFee,
    total,
    perPerson: groupSize ? Math.ceil(total / groupSize) : 0
  };
}

function makeRationale(selection, request, aiRationale = '') {
  if (aiRationale) return aiRationale;
  const enterpriseNames = selection.selectedEnterprises.map((item) => item.name).join(', ');
  const parts = [
    `Подбор сделан для цели "${goalLabel(request.goal)}" и группы "${groupLabel(request.groupType)}".`,
    `Выбраны объекты: ${enterpriseNames || 'нет подходящих объектов'}.`,
    selection.selectedTransport ? `Транспорт: ${selection.selectedTransport.name}, вместимость ${selection.selectedTransport.capacity} мест.` : 'Подходящий транспорт не найден.',
    selection.selectedFood ? `Питание: ${selection.selectedFood.name}.` : 'Питание не включено для короткой программы.',
    selection.selectedAccommodation ? `Размещение: ${selection.selectedAccommodation.name}.` : 'Размещение не требуется.'
  ];
  return parts.join(' ');
}

function composeProposal(tour) {
  const overnight = tour.request.overnight ? 'с ночёвкой' : 'без ночёвки';
  return [
    `Готовое предложение: промышленный тур в городе ${tour.request.city} для группы "${groupLabel(tour.request.groupType)}", ${tour.request.groupSize} человек, ${tour.request.durationHours} часов, ${overnight}.`,
    `Цель визита: ${goalLabel(tour.request.goal)}. Интересы: ${tour.request.interests || 'не указаны'}.`,
    `Стоимость: ${tour.pricing.total.toLocaleString('ru-RU')} ₽ на группу, ${tour.pricing.perPerson.toLocaleString('ru-RU')} ₽ на человека.`,
    `Ссылка для клиента: /proposal/${tour.publicCode}`
  ].join('\n');
}

function extractJson(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const source = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(source);
  } catch {
    const start = source.indexOf('{');
    const end = source.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(source.slice(start, end + 1));
    }
  }
  return null;
}

function getAiResponseContent(data) {
  const choice = data?.choices?.[0] || {};
  const message = choice.message || {};
  return String(
    message.content
    || choice.text
    || data?.output_text
    || ''
  );
}

function getAiReasoningContent(data) {
  const choice = data?.choices?.[0] || {};
  return String(choice.message?.reasoning_content || '');
}

function describeAiResponse(data) {
  const choice = data?.choices?.[0] || {};
  const message = choice.message || {};
  return {
    dataKeys: Object.keys(data || {}),
    choiceKeys: Object.keys(choice || {}),
    messageKeys: Object.keys(message || {}),
    contentLength: String(message.content || '').length,
    reasoningLength: String(message.reasoning_content || '').length,
    finishReason: choice.finish_reason || choice.finishReason || null
  };
}

function makeAiErrorPreview(data, content) {
  const shape = describeAiResponse(data);
  const text = String(content || '').trim();
  if (text) return text.slice(0, 300);
  const reasoning = getAiReasoningContent(data).trim();
  if (reasoning) return `reasoning_content: ${reasoning.slice(0, 260)}`;
  return JSON.stringify(shape).slice(0, 300);
}

function plannerSystemPrompt() {
  return [
    'You are a JSON-only adapter for an industrial tour planner.',
    'Select the best candidate ids for the request.',
    'Rules: choose 1-3 enterprises; respect group type, capacity, duration, working hours, available starts, city, goal, and interests.',
    'For school groups prefer free or cheaper enterprises unless interests require otherwise.',
    'If duration is 5 hours or more, select one food place when available.',
    'Select one transport company with enough seats.',
    'Return only compact valid JSON with keys: summary, rationale, selectedEnterpriseIds, selectedFoodId, selectedTransportId, selectedAccommodationId, risks.',
    'Do not write reasoning outside JSON. Do not use markdown. Do not invent ids.'
  ].join(' ');
}

async function callAiPlanner(request, candidates) {
  const creds = await loadAiCreds();
  const baseDiagnostic = {
    provider: 'chat-completions',
    apiUrl: creds.AI_API_URL,
    requestUrl: resolveChatCompletionsUrl(creds.AI_API_URL),
    model: creds.AI_API_MODEL,
    checkedAt: new Date().toISOString()
  };

  if (!creds.AI_API_KEY || creds.AI_API_KEY === 'your_key') {
    return {
      plan: null,
      diagnostic: {
        ...baseDiagnostic,
        mode: 'fallback',
        reason: 'AI_API_KEY не указан'
      }
    };
  }
  const safeCandidates = {
    enterprises: candidates.enterprises.slice(0, 8).map(({ id, externalId, name, industry, description, tags, durationMinutes, capacity, prices, availableStarts, selectedFormat, coordinates, workStart, workEnd, score }) => ({
      id, externalId, name, industry, description, tags, durationMinutes, capacity, prices, availableStarts, selectedFormat, coordinates, workStart, workEnd, score
    })),
    foodPlaces: candidates.foodPlaces.slice(0, 5),
    accommodations: candidates.accommodations.slice(0, 5),
    transports: candidates.transports.slice(0, 5)
  };

  const messages = [
    { role: 'system', content: plannerSystemPrompt() },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'Собери промышленный тур. Верни только компактный JSON без markdown и объяснений.',
        responseSchema: {
          summary: 'string',
          rationale: 'string',
          selectedEnterpriseIds: ['number'],
          selectedFoodId: 'number|null',
          selectedTransportId: 'number|null',
          selectedAccommodationId: 'number|null',
          risks: ['string']
        },
        request,
        candidates: safeCandidates
      })
    }
  ];

  const response = await fetch(resolveChatCompletionsUrl(creds.AI_API_URL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${creds.AI_API_KEY}`
    },
    body: JSON.stringify({
      model: creds.AI_API_MODEL,
      messages,
      temperature: 0.2,
      max_tokens: 4096,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    return {
      plan: null,
      diagnostic: {
        ...baseDiagnostic,
        mode: 'fallback',
        reason: `LLM API вернул HTTP ${response.status}`,
        errorPreview: errorText.slice(0, 240)
      }
    };
  }

  const data = await response.json();
  const content = getAiResponseContent(data);
  const plan = extractJson(content);
  if (!plan) {
    const shape = describeAiResponse(data);
    return {
      plan: null,
      diagnostic: {
        ...baseDiagnostic,
        mode: 'fallback',
        reason: content.trim()
          ? 'LLM ответила, но ответ не удалось разобрать как JSON'
          : 'LLM API ответил, но поле content пустое',
        errorPreview: makeAiErrorPreview(data, content),
        responseShape: shape
      }
    };
  }

  return {
    plan,
    diagnostic: {
      ...baseDiagnostic,
      mode: 'llm',
      reason: 'LLM успешно ответила валидным JSON'
    }
  };
}

function matchCandidateByAiId(items, value) {
  if (value === null || value === undefined || value === '') return null;
  const needle = String(value).trim();
  const numeric = Number(needle);
  return items.find((item) => item.id === numeric)
    || items.find((item) => String(item.externalId || '').trim() === needle)
    || items.find((item) => String(item.company_id || '').trim() === needle)
    || null;
}

function normalizeAiPlan(aiPlan, candidates) {
  if (!aiPlan || typeof aiPlan !== 'object') return null;
  const selectedEnterpriseIds = Array.isArray(aiPlan.selectedEnterpriseIds)
    ? aiPlan.selectedEnterpriseIds
    : [];
  const normalized = {
    summary: aiPlan.summary || aiPlan.tour_name || '',
    rationale: aiPlan.rationale || '',
    selectedEnterpriseIds,
    selectedFoodId: aiPlan.selectedFoodId,
    selectedTransportId: aiPlan.selectedTransportId,
    selectedAccommodationId: aiPlan.selectedAccommodationId,
    risks: Array.isArray(aiPlan.risks) ? aiPlan.risks : []
  };

  if (!normalized.rationale && Array.isArray(aiPlan.reasoning)) {
    normalized.rationale = aiPlan.reasoning.join(' ');
  }

  if (!normalized.selectedEnterpriseIds.length && Array.isArray(aiPlan.itinerary)) {
    normalized.selectedEnterpriseIds = aiPlan.itinerary
      .map((item) => item.enterprise_id || item.enterpriseId || item.enterprise || item.object_id || item.objectId)
      .map((id) => matchCandidateByAiId(candidates.enterprises, id)?.id)
      .filter(Boolean);
  }

  if (!normalized.selectedTransportId && aiPlan.transport) {
    const transportId = aiPlan.transport.company_id || aiPlan.transport.companyId || aiPlan.transport.id;
    normalized.selectedTransportId = matchCandidateByAiId(candidates.transports, transportId)?.id;
  }

  if (!normalized.selectedFoodId && (aiPlan.food || aiPlan.meal || aiPlan.catering)) {
    const food = aiPlan.food || aiPlan.meal || aiPlan.catering;
    const foodId = food.place_id || food.placeId || food.id;
    normalized.selectedFoodId = matchCandidateByAiId(candidates.foodPlaces, foodId)?.id;
  }

  if (!normalized.selectedAccommodationId && (aiPlan.accommodation || aiPlan.hotel)) {
    const accommodation = aiPlan.accommodation || aiPlan.hotel;
    const accommodationId = accommodation.place_id || accommodation.placeId || accommodation.id;
    normalized.selectedAccommodationId = matchCandidateByAiId(candidates.accommodations, accommodationId)?.id;
  }

  return normalized;
}

function applyAiSelection(aiPlan, fallbackSelection) {
  if (!aiPlan) return fallbackSelection;
  const candidates = fallbackSelection.candidates;
  const normalizedPlan = normalizeAiPlan(aiPlan, candidates);
  if (!normalizedPlan) return fallbackSelection;
  const enterpriseIds = normalizedPlan.selectedEnterpriseIds.map(Number);
  const selectedEnterprises = enterpriseIds
    .map((id) => candidates.enterprises.find((item) => item.id === id))
    .filter(Boolean);
  const requestedCount = fallbackSelection.selectedEnterprises.length;
  const supplementedEnterprises = [...selectedEnterprises];
  for (const enterprise of fallbackSelection.selectedEnterprises) {
    if (supplementedEnterprises.length >= requestedCount) break;
    if (!supplementedEnterprises.some((item) => item.id === enterprise.id)) {
      supplementedEnterprises.push(enterprise);
    }
  }

  return {
    ...fallbackSelection,
    selectedEnterprises: supplementedEnterprises.length ? supplementedEnterprises : fallbackSelection.selectedEnterprises,
    selectedFood: candidates.foodPlaces.find((item) => item.id === Number(normalizedPlan.selectedFoodId)) || fallbackSelection.selectedFood,
    selectedTransport: candidates.transports.find((item) => item.id === Number(normalizedPlan.selectedTransportId)) || fallbackSelection.selectedTransport,
    selectedAccommodation: candidates.accommodations.find((item) => item.id === Number(normalizedPlan.selectedAccommodationId)) || fallbackSelection.selectedAccommodation,
    aiSummary: normalizedPlan.summary || '',
    aiRationale: normalizedPlan.rationale || '',
    risks: normalizedPlan.risks
  };
}

async function assembleTour(store, request, selection, previous = {}) {
  const route = await buildOsrmRoute(selection, request);
  const program = buildProgram(selection, request, route);
  const pricing = calculatePricing(selection, request);
  const publicCode = previous.publicCode || Math.random().toString(36).slice(2, 10);
  const tour = {
    ...previous,
    id: previous.id || Date.now(),
    publicCode,
    createdAt: previous.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: previous.status || 'draft',
    request,
    selection: {
      enterpriseIds: selection.selectedEnterprises.map((item) => item.id),
      foodId: selection.selectedFood?.id || null,
      transportId: selection.selectedTransport?.id || null,
      accommodationId: selection.selectedAccommodation?.id || null
    },
    selected: {
      enterprises: selection.selectedEnterprises,
      food: selection.selectedFood,
      transport: selection.selectedTransport,
      accommodation: selection.selectedAccommodation
    },
    route: { city: request.city, ...route },
    program,
    pricing,
    rationale: [makeRationale(selection, request, selection.aiRationale), ...(selection.requestedNotes || [])].join(' '),
    aiSummary: selection.aiSummary || '',
    risks: [...(selection.risks || []), ...(selection.requestedNotes || [])],
    proposalUrl: `/proposal/${publicCode}`
  };
  tour.proposalText = composeProposal(tour);
  return tour;
}

async function planTour(request) {
  const store = await readJson(storePath);
  const resolvedRequest = await resolveMeetingPoint(request);
  const fallback = chooseByRules(store, resolvedRequest);
  if (!fallback.selectedEnterprises.length || !fallback.selectedTransport) {
    return { error: 'Не хватает подходящих предприятий или транспорта для выбранных параметров.' };
  }

  let aiPlan = null;
  let aiDiagnostic = null;
  try {
    const aiResult = await callAiPlanner(resolvedRequest, fallback.candidates);
    aiPlan = aiResult?.plan || null;
    aiDiagnostic = aiResult?.diagnostic || null;
  } catch (err) {
    console.error('AI planner error:', err.message);
    aiDiagnostic = {
      mode: 'fallback',
      reason: `Ошибка вызова LLM: ${err.message}`,
      checkedAt: new Date().toISOString()
    };
  }

  const selection = applyAiSelection(aiPlan, fallback);
  const tour = await assembleTour(store, resolvedRequest, selection);
  tour.aiUsed = Boolean(aiPlan);
  tour.aiDiagnostic = aiDiagnostic || {
    mode: 'fallback',
    reason: 'LLM не вызывалась',
    checkedAt: new Date().toISOString()
  };
  store.tours.unshift(tour);
  await writeJson(storePath, store);
  return { tour, candidates: fallback.candidates };
}

async function testAiConnection() {
  const creds = await loadAiCreds();
  const systemPrompt = await loadSystemPrompt(creds);
  const diagnostic = {
    apiUrl: creds.AI_API_URL,
    requestUrl: resolveChatCompletionsUrl(creds.AI_API_URL),
    model: creds.AI_API_MODEL,
    hasKey: Boolean(creds.AI_API_KEY),
    checkedAt: new Date().toISOString()
  };

  if (!creds.AI_API_KEY || creds.AI_API_KEY === 'your_key') {
    return {
      ok: false,
      ...diagnostic,
      message: 'AI_API_KEY не указан'
    };
  }

  try {
    const response = await fetch(resolveChatCompletionsUrl(creds.AI_API_URL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.AI_API_KEY}`
      },
      body: JSON.stringify({
        model: creds.AI_API_MODEL,
        messages: [
          { role: 'system', content: systemPrompt || 'Ты отвечаешь только JSON.' },
          { role: 'user', content: 'Верни JSON {"ok":true,"message":"connected"} без markdown.' }
        ],
        temperature: 0,
        max_tokens: 512
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return {
        ok: false,
        ...diagnostic,
        message: `LLM API вернул HTTP ${response.status}`,
        errorPreview: errorText.slice(0, 300)
      };
    }

    const data = await response.json();
    const content = getAiResponseContent(data);
    const hasContent = Boolean(content.trim());
    return {
      ok: hasContent,
      ...diagnostic,
      message: hasContent ? 'Подключение работает: LLM ответила' : 'LLM API ответил, но поле content пустое',
      responsePreview: content.slice(0, 300),
      responseShape: describeAiResponse(data)
    };
  } catch (err) {
    return {
      ok: false,
      ...diagnostic,
      message: `Не удалось вызвать LLM: ${err.message}`
    };
  }
}

async function updateSelection(store, tour, body) {
  const selectedEnterprises = (body.enterpriseIds || tour.selection.enterpriseIds)
    .map((id) => store.enterprises.find((item) => item.id === Number(id)))
    .filter(Boolean);
  const selectedFood = body.foodId === null ? null : store.foodPlaces.find((item) => item.id === Number(body.foodId || tour.selection.foodId)) || null;
  const selectedTransport = store.transportCompanies.find((item) => item.id === Number(body.transportId || tour.selection.transportId)) || null;
  const selectedAccommodation = body.accommodationId === null
    ? null
    : store.accommodations.find((item) => item.id === Number(body.accommodationId || tour.selection.accommodationId)) || null;

  const selection = { selectedEnterprises, selectedFood, selectedTransport, selectedAccommodation };
  return assembleTour(store, tour.request, selection, tour);
}

async function handleApi(req, res, url) {
  const store = await readJson(storePath);

  if (req.method === 'GET' && url.pathname === '/api/catalog') {
    return sendJson(res, 200, {
      enterprises: store.enterprises,
      foodPlaces: store.foodPlaces,
      accommodations: store.accommodations,
      transportCompanies: store.transportCompanies
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/tours') {
    return sendJson(res, 200, { data: store.tours });
  }

  if (req.method === 'POST' && url.pathname === '/api/tours/plan') {
    const body = await readBody(req);
    const request = {
      city: body.city || 'Киров',
      groupType: body.groupType || 'school',
      groupSize: Number(body.groupSize || 20),
      durationHours: Number(body.durationHours || 5),
      goal: body.goal || 'career',
      interests: body.interests || '',
      overnight: Boolean(body.overnight),
      startTime: body.startTime || '09:00',
      meetingPoint: body.meetingPoint || 'по согласованию',
      meetingCoordinates: validCoordinates(body.meetingCoordinates) ? body.meetingCoordinates : null
    };
    const result = await planTour(request);
    if (result.error) return sendError(res, 422, result.error);
    return sendJson(res, 201, result);
  }

  const tourSelectionMatch = url.pathname.match(/^\/api\/tours\/(\d+)\/selection$/);
  if (req.method === 'PUT' && tourSelectionMatch) {
    const body = await readBody(req);
    const id = Number(tourSelectionMatch[1]);
    const index = store.tours.findIndex((item) => item.id === id);
    if (index < 0) return sendError(res, 404, 'Тур не найден');
    const updated = await updateSelection(store, store.tours[index], body);
    store.tours[index] = updated;
    await writeJson(storePath, store);
    return sendJson(res, 200, { tour: updated });
  }

  const publicTourMatch = url.pathname.match(/^\/api\/public\/tours\/([^/]+)$/);
  if (req.method === 'GET' && publicTourMatch) {
    const tour = store.tours.find((item) => item.publicCode === publicTourMatch[1]);
    if (!tour) return sendError(res, 404, 'Предложение не найдено');
    return sendJson(res, 200, { tour });
  }

  const bookingMatch = url.pathname.match(/^\/api\/public\/tours\/([^/]+)\/book$/);
  if (req.method === 'POST' && bookingMatch) {
    const tour = store.tours.find((item) => item.publicCode === bookingMatch[1]);
    if (!tour) return sendError(res, 404, 'Предложение не найдено');
    const body = await readBody(req);
    const booking = {
      id: Date.now(),
      tourId: tour.id,
      publicCode: tour.publicCode,
      customerName: body.customerName || 'Клиент',
      email: body.email || '',
      phone: body.phone || '',
      status: 'awaiting_mock_payment',
      createdAt: new Date().toISOString()
    };
    store.bookings.unshift(booking);
    tour.status = 'sent';
    store.notifications.unshift({
      id: Date.now() + 1,
      type: 'email',
      to: booking.email,
      subject: `Бронирование тура ${tour.request.city}`,
      status: 'mock_sent',
      createdAt: new Date().toISOString()
    });
    await writeJson(storePath, store);
    return sendJson(res, 201, { booking });
  }

  const payMatch = url.pathname.match(/^\/api\/public\/tours\/([^/]+)\/pay\/mock$/);
  if (req.method === 'POST' && payMatch) {
    const tour = store.tours.find((item) => item.publicCode === payMatch[1]);
    if (!tour) return sendError(res, 404, 'Предложение не найдено');
    tour.status = 'paid';
    const booking = store.bookings.find((item) => item.publicCode === tour.publicCode);
    if (booking) booking.status = 'paid_mock';
    await writeJson(storePath, store);
    return sendJson(res, 200, { status: 'paid_mock', tour });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/ai-creds') {
    const creds = await loadAiCreds();
    const systemPrompt = await loadSystemPrompt(creds);
    return sendJson(res, 200, {
      ...creds,
      AI_SYSTEM_PROMPT: systemPrompt,
      AI_API_KEY: creds.AI_API_KEY ? `${creds.AI_API_KEY.slice(0, 4)}…${creds.AI_API_KEY.slice(-4)}` : ''
    });
  }

  if (req.method === 'PUT' && url.pathname === '/api/admin/ai-creds') {
    const body = await readBody(req);
    const current = await loadAiCreds();
    const updated = {
      AI_API_URL: body.AI_API_URL || current.AI_API_URL,
      AI_API_KEY: body.AI_API_KEY && !body.AI_API_KEY.includes('…') ? body.AI_API_KEY : current.AI_API_KEY,
      AI_API_MODEL: body.AI_API_MODEL || current.AI_API_MODEL,
      AI_SYSTEM_PROMPT: body.AI_SYSTEM_PROMPT ?? current.AI_SYSTEM_PROMPT
    };
    await writeJson(aiCredPath, updated);
    if (body.AI_SYSTEM_PROMPT !== undefined) {
      await writeFile(internalPromptPath, body.AI_SYSTEM_PROMPT, 'utf-8');
    }
    return sendJson(res, 200, { message: 'Настройки AI сохранены' });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/ai-test') {
    return sendJson(res, 200, await testAiConnection());
  }

  const catalogMatch = url.pathname.match(/^\/api\/admin\/catalog\/(enterprises|foodPlaces|accommodations|transportCompanies)(?:\/(\d+))?$/);
  if (req.method === 'POST' && catalogMatch && !catalogMatch[2]) {
    const collection = catalogMatch[1];
    const body = await readBody(req);
    if (!String(body.name || '').trim()) return sendError(res, 422, 'Название обязательно');
    const nextId = Math.max(0, ...store[collection].map((item) => item.id)) + 1;
    const item = { id: nextId, ...body };
    store[collection].push(item);
    await writeJson(storePath, store);
    return sendJson(res, 201, { item });
  }

  if (req.method === 'PUT' && catalogMatch && catalogMatch[2]) {
    const collection = catalogMatch[1];
    const id = Number(catalogMatch[2]);
    const index = store[collection].findIndex((item) => item.id === id);
    if (index < 0) return sendError(res, 404, 'Объект справочника не найден');
    const body = await readBody(req);
    if (!String(body.name || store[collection][index].name || '').trim()) return sendError(res, 422, 'Название обязательно');
    store[collection][index] = { ...store[collection][index], ...body, id };
    await writeJson(storePath, store);
    return sendJson(res, 200, { item: store[collection][index] });
  }

  if (req.method === 'DELETE' && catalogMatch && catalogMatch[2]) {
    const collection = catalogMatch[1];
    const id = Number(catalogMatch[2]);
    const index = store[collection].findIndex((item) => item.id === id);
    if (index < 0) return sendError(res, 404, 'Объект справочника не найден');
    const selectionKey = {
      enterprises: 'enterpriseIds',
      foodPlaces: 'foodId',
      accommodations: 'accommodationId',
      transportCompanies: 'transportId'
    }[collection];
    const used = store.tours.some((tour) => {
      const value = tour.selection?.[selectionKey];
      return Array.isArray(value) ? value.includes(id) : value === id;
    });
    if (used) return sendError(res, 409, 'Объект используется в сохранённом туре. Сначала замените его в турах.');
    const [deleted] = store[collection].splice(index, 1);
    await writeJson(storePath, store);
    return sendJson(res, 200, { item: deleted });
  }

  return sendError(res, 404, 'API route not found');
}

async function serveStatic(req, res, url) {
  let filePath = url.pathname === '/' ? path.join(publicDir, 'index.html') : path.join(publicDir, url.pathname);
  if (!filePath.startsWith(publicDir)) return sendError(res, 403, 'Forbidden');
  if (!existsSync(filePath)) filePath = path.join(publicDir, 'index.html');

  const ext = path.extname(filePath);
  const content = await readFile(filePath);
  res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
  res.end(content);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    return sendError(res, 500, 'Внутренняя ошибка сервера');
  }
});

server.listen(PORT, () => {
  console.log(`Industrial tour AI MVP: http://localhost:${PORT}`);
});
