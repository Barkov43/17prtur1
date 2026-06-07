const state = {
  tab: 'landing',
  catalog: null,
  tours: [],
  currentTour: null,
  publicTour: null,
  aiCreds: null,
  aiTestResult: null,
  aiTesting: false,
  catalogEditing: null,
  catalogCollection: 'enterprises',
  loading: false,
  message: ''
};

const api = {
  async request(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Ошибка запроса');
    return data;
  },
  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  delete(path) { return this.request('DELETE', path); }
};

const rub = (value) => `${Number(value || 0).toLocaleString('ru-RU')} ₽`;

function groupLabel(type) {
  return {
    school: 'Школьники',
    student: 'Студенты',
    business: 'Бизнес-делегация'
  }[type] || type;
}

function goalLabel(goal) {
  return {
    career: 'Профориентация',
    tasting: 'Экскурсия с дегустацией',
    exchange: 'Обмен опытом',
    business: 'Бизнес-туризм'
  }[goal] || goal;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function loadBase() {
  const [catalog, tours] = await Promise.all([
    api.get('/api/catalog'),
    api.get('/api/tours')
  ]);
  state.catalog = catalog;
  state.tours = tours.data || [];
}

async function init() {
  const publicMatch = location.pathname.match(/^\/proposal\/([^/]+)/);
  if (publicMatch) {
    await loadPublicTour(publicMatch[1]);
    return;
  }
  const requestedTab = new URLSearchParams(location.search).get('tab');
  if (['landing', 'builder', 'tours', 'catalog', 'ai'].includes(requestedTab)) state.tab = requestedTab;
  await loadBase();
  render();
}

function render() {
  document.querySelector('#app').innerHTML = `
    <div class="app-frame">
      <header class="app-header">
        <div class="brand" data-tab="landing">
          <span class="brand-mark">17</span>
          <div>
            <strong>ПромТур AI</strong>
            <span>умный конструктор маршрутов</span>
          </div>
        </div>
        <nav class="nav">
          ${navButton('landing', 'О проекте')}
          ${navButton('builder', 'Сборка тура')}
          ${navButton('tours', 'Созданные туры')}
          ${navButton('catalog', 'Справочники')}
          ${navButton('ai', 'AI настройки')}
        </nav>
        <button class="btn primary header-action" data-start-builder>Собрать тур</button>
      </header>
      <main class="main">
        ${state.tab === 'landing' ? '' : renderTopbar()}
        ${state.message ? `<div class="notice">${escapeHtml(state.message)}</div>` : ''}
        ${state.tab === 'landing' ? renderLanding() : ''}
        ${state.tab === 'builder' ? renderBuilder() : ''}
        ${state.tab === 'tours' ? renderTours() : ''}
        ${state.tab === 'catalog' ? renderCatalog() : ''}
        ${state.tab === 'ai' ? renderAiSettings() : ''}
      </main>
      <footer class="app-footer">© 2026 ПромТур AI · промышленный туризм с умной маршрутизацией</footer>
    </div>
  `;
  bindEvents();
}

function navButton(tab, label) {
  return `<button data-tab="${tab}" class="${state.tab === tab ? 'active' : ''}">${label}</button>`;
}

function renderTopbar() {
  const title = {
    landing: 'Нейросети в промышленном туризме',
    builder: 'Сборка нового тура',
    tours: 'Созданные предложения',
    catalog: 'Справочники маршрутизации',
    ai: 'Настройки внутренней LLM'
  }[state.tab];
  const subtitle = {
    landing: 'MVP для туроператора: подбор предприятий, транспорта, питания, размещения и стоимости промышленного тура под конкретную группу.',
    builder: 'Туроператор вводит параметры группы, система подбирает объекты, транспорт, питание, размещение и считает стоимость.',
    tours: 'Черновики и отправленные предложения с публичной ссылкой для клиента.',
    catalog: 'Тестовая база предприятий, питания, размещения и транспорта для MVP.',
    ai: 'OpenAI-compatible endpoint: URL, ключ, модель и системный промпт.'
  }[state.tab];
  return `
    <div class="topbar">
      <div>
        <h1>${title}</h1>
        <p>${subtitle}</p>
      </div>
      <span class="badge">Роль: туроператор MVP</span>
    </div>
  `;
}

function renderLanding() {
  return `
    <section class="landing">
      <div class="landing-intro">
        <span class="landing-kicker">AI + OSRM · маршрут по реальным дорогам</span>
        <h1>Промышленный тур под любую группу за несколько минут</h1>
        <p>Предприятия, логистика, питание, размещение и точная стоимость в одном готовом предложении для клиента.</p>
        <div class="actions">
          <button class="btn primary" data-start-builder>Собрать новый тур</button>
          <button class="btn secondary" data-tab="catalog">Управлять справочниками</button>
        </div>
      </div>
      <div class="landing-hero">
        <img src="/assets/industrial-tour-hero.png" alt="Промышленный туризм и AI-планирование маршрута" />
        <div class="landing-product-preview">
          <span>Маршрут рассчитан</span>
          <strong>4 объекта · 18,6 км</strong>
          <small>OSRM проверил время в пути</small>
        </div>
      </div>
      <div class="landing-stats">
        <div><strong>5-10 минут</strong><span>на готовое предложение</span></div>
        <div><strong>OSRM</strong><span>реальные дороги и время</span></div>
        <div><strong>1 ссылка</strong><span>для бронирования клиентом</span></div>
      </div>
      <div class="landing-sections">
        <article>
          <h3>Проблема</h3>
          <p>Подготовка промышленного тура вручную занимает много времени: нужно сверить предприятия, вместимость, питание, транспорт, размещение и бюджет.</p>
        </article>
        <article>
          <h3>Решение</h3>
          <p>Туроператор вводит город, тип группы, численность, длительность и интересы. Система собирает маршрут и объясняет выбор объектов.</p>
        </article>
        <article>
          <h3>MVP</h3>
          <p>В проекте есть конструктор тура, справочники объектов, LLM-подбор, ручное редактирование, публичная ссылка и эмуляция бронирования.</p>
        </article>
      </div>
    </section>
  `;
}

function renderBuilder() {
  return `
    <section class="grid">
      <form id="tour-form" class="panel form-grid">
        <h2>Параметры группы</h2>
        <div class="row">
          <div class="field">
            <label>Город тура</label>
            <select name="city">
              ${cityOptions()}
            </select>
          </div>
          <div class="field">
            <label>Тип группы</label>
            <select name="groupType">
              <option value="school">Школьники</option>
              <option value="student">Студенты</option>
              <option value="business">Бизнес-делегация</option>
            </select>
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label>Количество человек</label>
            <input name="groupSize" type="number" min="1" max="100" value="25" />
          </div>
          <div class="field">
            <label>Длительность дневной программы</label>
            <select name="durationHours">
              <option value="3">3 часа</option>
              <option value="5" selected>5 часов</option>
              <option value="7">7 часов</option>
            </select>
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label>Цель визита</label>
            <select name="goal">
              <option value="career">Профориентация</option>
              <option value="tasting">Экскурсия с дегустацией</option>
              <option value="exchange">Обмен опытом</option>
              <option value="business">Бизнес-туризм</option>
            </select>
          </div>
          <div class="field">
            <label>Старт</label>
            <input name="startTime" type="time" value="09:00" />
          </div>
        </div>
        <div class="field">
          <label>Интересы группы</label>
          <textarea name="interests" placeholder="Например: роботизация, дегустация, профессии технолога">роботизация, производство еды, профориентация</textarea>
        </div>
        <div class="field">
          <label>Точка сбора</label>
          <input name="meetingPoint" value="г. Киров, ул. Ленина, 1" />
        </div>
        <label class="checkbox-row">
          <input name="overnight" type="checkbox" />
          <span>Добавить размещение и ночёвку</span>
        </label>
        <div class="actions">
          <button class="btn primary" type="submit">${state.loading ? 'Собираю...' : 'Собрать тур'}</button>
          <button class="btn ghost" type="button" data-demo>Демо для бизнес-группы</button>
        </div>
      </form>
      <div>
        ${state.currentTour ? renderTourResult(state.currentTour) : renderEmptyResult()}
      </div>
    </section>
  `;
}

function cityOptions() {
  const cities = [...new Set(state.catalog.enterprises.map((item) => item.city))];
  return cities.map((city) => `<option value="${escapeHtml(city)}">${escapeHtml(city)}</option>`).join('');
}

function renderEmptyResult() {
  return `
    <div class="panel">
      <h2>Готовая программа появится здесь</h2>
      <p class="muted">После сборки система покажет маршрут, программу по минутам, стоимость, объяснение выбора и ссылку для клиента.</p>
      <div class="empty">Пока тур не собран</div>
    </div>
  `;
}

function renderTourResult(tour) {
  return `
    <div class="panel">
      <div class="actions" style="justify-content: space-between">
        <h2 style="margin:0">Предложение #${tour.id}</h2>
        <span class="status ${tour.status === 'paid' ? 'paid' : ''}">${tour.status}</span>
      </div>
      ${renderMetrics(tour)}
      <h3>Маршрут</h3>
      ${renderRoute(tour)}
      <h3>Программа по минутам</h3>
      ${renderTimeline(tour.program)}
      <h3>Почему выбран этот тур</h3>
      <p class="muted">${escapeHtml(tour.rationale)}</p>
      ${renderAiDiagnostic(tour)}
      ${renderManualEdit(tour)}
      <div class="actions" style="margin-top:14px">
        <a class="btn primary" href="${tour.proposalUrl}" target="_blank">Открыть ссылку клиента</a>
        <button class="btn ghost" data-print>PDF через печать</button>
      </div>
    </div>
  `;
}

function renderAiDiagnostic(tour) {
  const diagnostic = tour.aiDiagnostic || {};
  const isLlm = tour.aiUsed || diagnostic.mode === 'llm';
  return `
    <div class="notice" style="margin:12px 0">
      <strong>${isLlm ? 'LLM подключилась' : 'Fallback по правилам'}</strong><br>
      <span>${escapeHtml(diagnostic.reason || (isLlm ? 'Модель использовалась при подборе.' : 'Модель не использовалась при подборе.'))}</span>
      ${diagnostic.model ? `<br><span class="muted">Модель: ${escapeHtml(diagnostic.model)}</span>` : ''}
      ${diagnostic.errorPreview ? `<br><span class="muted">Ответ API: ${escapeHtml(diagnostic.errorPreview)}</span>` : ''}
    </div>
  `;
}

function renderMetrics(tour) {
  return `
    <div class="summary-grid" style="margin:14px 0">
      <div class="metric"><span>На группу</span><strong>${rub(tour.pricing.total)}</strong></div>
      <div class="metric"><span>На человека</span><strong>${rub(tour.pricing.perPerson)}</strong></div>
      <div class="metric"><span>Группа</span><strong>${tour.request.groupSize}</strong></div>
      <div class="metric"><span>Формат</span><strong>${tour.request.durationHours} ч</strong></div>
    </div>
  `;
}

function renderRoute(tour) {
  const route = tour.route || {};
  const geocoding = route.meetingGeocoding || {};
  const mapData = {
    geometry: route.geometry || null,
    stops: (route.stops || []).filter((stop) => stop.coordinates)
  };
  return `
    <div class="route-summary">
      <span class="route-provider">${route.provider === 'osrm' ? 'OSRM маршрут' : 'Расчётный маршрут'}</span>
      ${route.distanceKm ? `<strong>Пробег автобуса: ${route.distanceKm} км</strong>` : ''}
      ${route.durationMinutes ? `<strong>Все переезды: ${route.durationMinutes} мин без пробок</strong>` : ''}
      ${route.warning ? `<span class="route-warning">${escapeHtml(route.warning)}</span>` : ''}
    </div>
    ${geocoding.displayName ? `<div class="route-geocoding"><strong>Точка сбора найдена:</strong> ${escapeHtml(geocoding.displayName)}</div>` : ''}
    <div class="route-live-map" data-route="${escapeHtml(JSON.stringify(mapData))}"></div>
    <div class="route-map">
      ${tour.route.points.map((point, index) => `
        <span class="route-point">${escapeHtml(point)}</span>
        ${index < tour.route.points.length - 1 ? '<span class="arrow">→</span>' : ''}
      `).join('')}
    </div>
  `;
}

function initializeRouteMaps() {
  document.querySelectorAll('.route-live-map').forEach((element) => {
    if (!window.maplibregl || element.dataset.ready === 'true') return;
    let data;
    try {
      data = JSON.parse(element.dataset.route || '{}');
    } catch {
      return;
    }
    const stops = data.stops || [];
    if (!stops.length) {
      element.innerHTML = '<div class="map-unavailable">Для карты не хватает координат объектов</div>';
      return;
    }
    const firstPoint = [Number(stops[0].coordinates.lng), Number(stops[0].coordinates.lat)];
    const map = new window.maplibregl.Map({
      container: element,
      style: {
        version: 8,
        sources: {
          'osm-tiles': {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 19,
            attribution: '© OpenStreetMap contributors'
          }
        },
        layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm-tiles' }]
      },
      center: firstPoint,
      zoom: 11,
      scrollZoom: false
    });
    map.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    const bounds = new window.maplibregl.LngLatBounds();
    stops.forEach((stop, index) => {
      const point = [Number(stop.coordinates.lng), Number(stop.coordinates.lat)];
      bounds.extend(point);
      const marker = document.createElement('div');
      marker.className = `map-marker ${stop.type === 'meeting' ? 'map-marker-meeting' : ''}`;
      marker.textContent = String(index + 1);
      new window.maplibregl.Marker({ element: marker })
        .setLngLat(point)
        .setPopup(new window.maplibregl.Popup({ offset: 24 }).setHTML(`<strong>${index + 1}. ${escapeHtml(stop.name)}</strong>`))
        .addTo(map);
    });
    map.on('load', () => {
      if (data.geometry?.coordinates?.length) {
        map.addSource('tour-route', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: data.geometry }
        });
        map.addLayer({
          id: 'tour-route-outline',
          type: 'line',
          source: 'tour-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.92 }
        });
        map.addLayer({
          id: 'tour-route',
          type: 'line',
          source: 'tour-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#5b35d5', 'line-width': 6, 'line-opacity': 0.96 }
        });
        data.geometry.coordinates.forEach((point) => bounds.extend(point));
      }
      map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 });
    });
    element.dataset.ready = 'true';
  });
}

function renderTimeline(program) {
  return `
    <div class="timeline">
      ${program.map((item) => `
        <div class="timeline-item">
          <div class="timeline-time">${item.time}-${item.endTime}</div>
          <div>
            <div class="timeline-title">${escapeHtml(item.title)}</div>
            <div class="muted">${escapeHtml(item.description)}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderManualEdit(tour) {
  const enterpriseChecks = state.catalog.enterprises
    .filter((item) => item.city === tour.request.city && item.capacity >= tour.request.groupSize)
    .map((item) => `
      <label class="checkbox-row">
        <input type="checkbox" name="enterpriseIds" value="${item.id}" ${tour.selection.enterpriseIds.includes(item.id) ? 'checked' : ''} />
        <span>${escapeHtml(item.name)} (${item.durationMinutes} мин, ${rub(item.prices[tour.request.groupType])}/чел.)</span>
      </label>
    `).join('');

  return `
    <form id="selection-form" class="panel" style="margin-top:16px; box-shadow:none">
      <h3>Ручная корректировка</h3>
      <div class="edit-grid">
        <div class="field">
          <label>Предприятия</label>
          <div class="form-grid">${enterpriseChecks}</div>
        </div>
        <div class="form-grid">
          <div class="field">
            <label>Питание</label>
            <select name="foodId">
              <option value="">Не включать</option>
              ${state.catalog.foodPlaces.filter((item) => item.city === tour.request.city).map((item) => `
                <option value="${item.id}" ${tour.selection.foodId === item.id ? 'selected' : ''}>${escapeHtml(item.name)} — ${rub(item.pricePerPerson)}/чел.</option>
              `).join('')}
            </select>
          </div>
          <div class="field">
            <label>Транспорт</label>
            <select name="transportId">
              ${state.catalog.transportCompanies.filter((item) => item.city === tour.request.city && item.capacity >= tour.request.groupSize).map((item) => `
                <option value="${item.id}" ${tour.selection.transportId === item.id ? 'selected' : ''}>${escapeHtml(item.name)} — ${item.capacity} мест</option>
              `).join('')}
            </select>
          </div>
          <div class="field">
            <label>Размещение</label>
            <select name="accommodationId">
              <option value="">Не включать</option>
              ${state.catalog.accommodations.filter((item) => item.city === tour.request.city && item.capacity >= tour.request.groupSize).map((item) => `
                <option value="${item.id}" ${tour.selection.accommodationId === item.id ? 'selected' : ''}>${escapeHtml(item.name)} — ${rub(item.pricePerPerson)}/чел.</option>
              `).join('')}
            </select>
          </div>
        </div>
      </div>
      <div class="actions" style="margin-top:14px">
        <button class="btn primary" type="submit">Пересчитать и сохранить</button>
      </div>
    </form>
  `;
}

function renderTours() {
  if (!state.tours.length) return '<div class="empty">Созданных туров пока нет</div>';
  return `
    <table class="list-table">
      <thead>
        <tr><th>Тур</th><th>Группа</th><th>Стоимость</th><th>Статус</th><th>Ссылка</th></tr>
      </thead>
      <tbody>
        ${state.tours.map((tour) => `
          <tr>
            <td><strong>${escapeHtml(tour.request.city)}</strong><br><span class="muted">${tour.selected.enterprises.map((item) => item.name).join(', ')}</span></td>
            <td>${groupLabel(tour.request.groupType)}<br>${tour.request.groupSize} чел.</td>
            <td>${rub(tour.pricing.total)}<br><span class="muted">${rub(tour.pricing.perPerson)} / чел.</span></td>
            <td><span class="status ${tour.status === 'paid' ? 'paid' : ''}">${tour.status}</span></td>
            <td><a href="${tour.proposalUrl}" target="_blank">Открыть</a></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderCatalog() {
  const sections = [
    ['enterprises', 'Предприятия'],
    ['foodPlaces', 'Питание'],
    ['accommodations', 'Размещение'],
    ['transportCompanies', 'Транспорт']
  ];
  const collection = state.catalogCollection;
  const editing = state.catalogEditing;
  return `
    <section class="catalog-workspace">
      <div class="catalog-toolbar">
        <div>
          <span class="eyebrow">Администрирование данных</span>
          <h2>Редактируемые справочники</h2>
          <p>Обновляйте цены, вместимость, расписание и координаты без изменения кода.</p>
        </div>
        <button class="btn primary" data-catalog-add>Добавить объект</button>
      </div>
      <div class="catalog-tabs">
        ${sections.map(([key, title]) => `<button class="${collection === key ? 'active' : ''}" data-catalog-collection="${key}">${title}<span>${state.catalog[key].length}</span></button>`).join('')}
      </div>
      ${editing ? renderCatalogEditor(collection, editing) : ''}
      <div class="catalog-list">
        ${state.catalog[collection].map((item) => renderCatalogItem(collection, item)).join('')}
      </div>
    </section>
  `;
}

function catalogMeta(collection, item) {
  if (collection === 'enterprises') return `${item.city}, ${item.industry || 'отрасль не указана'} · ${item.durationMinutes || 0} мин · до ${item.capacity || 0} чел.`;
  if (collection === 'foodPlaces') return `${item.city}, ${item.type || 'тип не указан'} · ${rub(item.pricePerPerson)} / чел. · ${item.capacity || 0} мест`;
  if (collection === 'accommodations') return `${item.city}, ${item.type || 'тип не указан'} · ${rub(item.pricePerPerson)} / чел. · ${item.capacity || 0} мест`;
  return `${item.city}, ${item.transportType || 'транспорт'} · ${item.capacity || 0} мест · ${rub(item.pricePerHour)} / час`;
}

function renderCatalogItem(collection, item) {
  const coords = item.coordinates;
  return `
    <article class="catalog-item">
      <div class="catalog-item-main">
        <span class="catalog-type">${escapeHtml(collection === 'enterprises' ? 'Предприятие' : collection === 'foodPlaces' ? 'Питание' : collection === 'accommodations' ? 'Размещение' : 'Транспорт')}</span>
        <h3>${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(catalogMeta(collection, item))}</p>
        <small>${escapeHtml(item.address || item.phone || 'Контактные данные не указаны')}</small>
      </div>
      <div class="catalog-item-side">
        ${coords ? `<span class="coordinate-badge">${Number(coords.lat).toFixed(4)}, ${Number(coords.lng).toFixed(4)}</span>` : '<span class="coordinate-badge missing">Нет координат</span>'}
        <div class="actions">
          <button class="btn secondary compact" data-catalog-edit="${item.id}">Изменить</button>
          <button class="btn danger compact" data-catalog-delete="${item.id}">Удалить</button>
        </div>
      </div>
    </article>
  `;
}

function catalogField(name, label, value = '', type = 'text', extra = '') {
  return `<div class="field"><label>${label}</label><input name="${name}" type="${type}" value="${escapeHtml(value)}" ${extra} /></div>`;
}

function renderCatalogEditor(collection, item) {
  const isNew = !item.id;
  return `
    <form id="catalog-form" class="catalog-editor">
      <input type="hidden" name="id" value="${item.id || ''}" />
      <div class="catalog-editor-head">
        <div><span class="eyebrow">${isNew ? 'Новая запись' : `Запись #${item.id}`}</span><h3>${isNew ? 'Добавление объекта' : 'Редактирование объекта'}</h3></div>
        <button class="btn secondary compact" type="button" data-catalog-cancel>Закрыть</button>
      </div>
      <div class="editor-grid">
        ${catalogField('name', 'Название', item.name, 'text', 'required')}
        ${catalogField('city', 'Город', item.city || 'Киров', 'text', 'required')}
        ${catalogField('address', 'Адрес', item.address)}
        ${collection === 'enterprises' ? catalogField('industry', 'Отрасль', item.industry) : ''}
        ${collection === 'foodPlaces' || collection === 'accommodations' ? catalogField('type', 'Тип', item.type) : ''}
        ${collection === 'transportCompanies' ? catalogField('transportType', 'Тип транспорта', item.transportType || 'автобус') : ''}
        ${catalogField('capacity', 'Вместимость', item.capacity || '', 'number', 'min="1" required')}
        ${collection === 'enterprises' ? catalogField('durationMinutes', 'Длительность экскурсии, мин', item.durationMinutes || 60, 'number', 'min="1"') : ''}
        ${collection === 'enterprises' ? catalogField('minGroup', 'Минимальная группа', item.minGroup || 1, 'number', 'min="1"') : ''}
        ${collection === 'enterprises' ? catalogField('priceSchool', 'Цена для школьника', item.prices?.school || 0, 'number', 'min="0"') : ''}
        ${collection === 'enterprises' ? catalogField('priceStudent', 'Цена для студента', item.prices?.student || 0, 'number', 'min="0"') : ''}
        ${collection === 'enterprises' ? catalogField('priceBusiness', 'Цена для бизнеса', item.prices?.business || 0, 'number', 'min="0"') : ''}
        ${collection === 'foodPlaces' || collection === 'accommodations' ? catalogField('pricePerPerson', 'Цена на человека', item.pricePerPerson || 0, 'number', 'min="0"') : ''}
        ${collection === 'foodPlaces' ? catalogField('minDurationMinutes', 'Минимальное время, мин', item.minDurationMinutes || 40, 'number', 'min="1"') : ''}
        ${collection === 'transportCompanies' ? catalogField('pricePerHour', 'Цена за час', item.pricePerHour || 0, 'number', 'min="0"') : ''}
        ${collection === 'transportCompanies' ? catalogField('minHours', 'Минимум часов', item.minHours || 1, 'number', 'min="1"') : ''}
        ${collection !== 'transportCompanies' ? catalogField('lat', 'Широта', item.coordinates?.lat || '', 'number', 'step="any"') : ''}
        ${collection !== 'transportCompanies' ? catalogField('lng', 'Долгота', item.coordinates?.lng || '', 'number', 'step="any"') : ''}
        ${collection === 'enterprises' ? catalogField('workStart', 'Начало работы', item.workStart || '09:00', 'time') : ''}
        ${collection === 'enterprises' ? catalogField('workEnd', 'Окончание работы', item.workEnd || '18:00', 'time') : ''}
        ${collection === 'enterprises' ? catalogField('availableStarts', 'Доступные старты через запятую', (item.availableStarts || []).join(', ')) : ''}
      </div>
      ${collection === 'enterprises' ? `<div class="field"><label>Описание</label><textarea name="description">${escapeHtml(item.description || '')}</textarea></div>` : ''}
      <div class="actions">
        <button class="btn primary" type="submit">${isNew ? 'Добавить' : 'Сохранить изменения'}</button>
        <button class="btn secondary" type="button" data-catalog-cancel>Отмена</button>
      </div>
    </form>
  `;
}

function catalogPayload(collection, form) {
  const value = Object.fromEntries(form.entries());
  const number = (name, fallback = 0) => Number(value[name] || fallback);
  const payload = {
    name: value.name.trim(),
    city: value.city.trim(),
    address: value.address?.trim() || '',
    capacity: number('capacity')
  };
  if (value.lat && value.lng) payload.coordinates = { lat: number('lat'), lng: number('lng') };
  if (collection === 'enterprises') {
    Object.assign(payload, {
      industry: value.industry?.trim() || '',
      description: value.description?.trim() || '',
      durationMinutes: number('durationMinutes', 60),
      minGroup: number('minGroup', 1),
      maxGroup: number('capacity'),
      prices: { school: number('priceSchool'), student: number('priceStudent'), business: number('priceBusiness') },
      workStart: value.workStart || '09:00',
      workEnd: value.workEnd || '18:00',
      availableStarts: String(value.availableStarts || '').split(',').map((part) => part.trim()).filter(Boolean),
      allowedGroups: ['school', 'student', 'business'],
      tags: state.catalogEditing?.tags || [],
      tourFormats: state.catalogEditing?.tourFormats || [],
      isFree: number('priceSchool') === 0
    });
  } else if (collection === 'foodPlaces') {
    Object.assign(payload, { type: value.type || '', pricePerPerson: number('pricePerPerson'), minDurationMinutes: number('minDurationMinutes', 40), tags: state.catalogEditing?.tags || [] });
  } else if (collection === 'accommodations') {
    Object.assign(payload, { type: value.type || '', pricePerPerson: number('pricePerPerson'), tags: state.catalogEditing?.tags || [] });
  } else {
    Object.assign(payload, { transportType: value.transportType || 'автобус', pricePerHour: number('pricePerHour'), minHours: number('minHours', 1), capacityMin: 1, capacityMax: number('capacity') });
  }
  return payload;
}

function renderAiSettings() {
  if (!state.aiCreds) {
    loadAiCreds();
    return '<div class="panel">Загрузка настроек AI...</div>';
  }
  return `
    <form id="ai-form" class="panel form-grid">
      <h2>OpenAI-compatible Chat Completions</h2>
      <div class="field">
        <label>API URL или base URL</label>
        <input name="AI_API_URL" value="${escapeHtml(state.aiCreds.AI_API_URL)}" />
      </div>
      <div class="row">
        <div class="field">
          <label>Модель</label>
          <input name="AI_API_MODEL" value="${escapeHtml(state.aiCreds.AI_API_MODEL)}" />
        </div>
        <div class="field">
          <label>API ключ ${state.aiCreds.AI_API_KEY ? `(сейчас ${escapeHtml(state.aiCreds.AI_API_KEY)})` : ''}</label>
          <input name="AI_API_KEY" placeholder="Оставьте пустым, чтобы не менять" />
        </div>
      </div>
      <div class="field">
        <label>Системный промпт внутренней LLM</label>
        <textarea name="AI_SYSTEM_PROMPT">${escapeHtml(state.aiCreds.AI_SYSTEM_PROMPT || '')}</textarea>
      </div>
      <div class="notice">Если ключ не указан или провайдер недоступен, MVP собирает тур правилами и помечает результат как fallback.</div>
      ${renderAiTestResult()}
      <div class="actions">
        <button class="btn primary" type="submit">Сохранить настройки</button>
        <button class="btn ghost" type="button" data-ai-test>${state.aiTesting ? 'Проверяю...' : 'Проверить подключение'}</button>
      </div>
    </form>
  `;
}

function renderAiTestResult() {
  if (!state.aiTestResult) return '';
  const result = state.aiTestResult;
  return `
    <div class="notice">
      <strong>${result.ok ? 'Подключение работает' : 'Подключение не подтверждено'}</strong><br>
      ${escapeHtml(result.message || '')}
      <br><span class="muted">Модель: ${escapeHtml(result.model || '')}</span>
      ${result.requestUrl ? `<br><span class="muted">Endpoint: ${escapeHtml(result.requestUrl)}</span>` : ''}
      <br><span class="muted">Ключ сохранён: ${result.hasKey ? 'да' : 'нет'}</span>
      ${result.responsePreview ? `<br><span class="muted">Ответ: ${escapeHtml(result.responsePreview)}</span>` : ''}
      ${result.errorPreview ? `<br><span class="muted">Ошибка API: ${escapeHtml(result.errorPreview)}</span>` : ''}
    </div>
  `;
}

async function loadAiCreds() {
  state.aiCreds = await api.get('/api/admin/ai-creds');
  render();
}

function bindEvents() {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.tab = button.dataset.tab;
      state.message = '';
      history.replaceState(null, '', state.tab === 'landing' ? location.pathname : `${location.pathname}?tab=${state.tab}`);
      render();
    });
  });

  document.querySelector('#tour-form')?.addEventListener('submit', handleTourSubmit);
  document.querySelector('[data-start-builder]')?.addEventListener('click', () => {
    state.tab = 'builder';
    history.replaceState(null, '', `${location.pathname}?tab=builder`);
    render();
  });
  document.querySelector('[data-demo]')?.addEventListener('click', fillBusinessDemo);
  document.querySelector('#selection-form')?.addEventListener('submit', handleSelectionSubmit);
  document.querySelector('[data-print]')?.addEventListener('click', () => window.print());
  document.querySelector('#ai-form')?.addEventListener('submit', handleAiSubmit);
  document.querySelector('[data-ai-test]')?.addEventListener('click', handleAiTest);
  document.querySelectorAll('[data-catalog-collection]').forEach((button) => {
    button.addEventListener('click', () => {
      state.catalogCollection = button.dataset.catalogCollection;
      state.catalogEditing = null;
      render();
    });
  });
  document.querySelector('[data-catalog-add]')?.addEventListener('click', () => {
    state.catalogEditing = {};
    render();
  });
  document.querySelectorAll('[data-catalog-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      state.catalogEditing = state.catalog[state.catalogCollection].find((item) => item.id === Number(button.dataset.catalogEdit));
      render();
    });
  });
  document.querySelectorAll('[data-catalog-cancel]').forEach((button) => {
    button.addEventListener('click', () => {
      state.catalogEditing = null;
      render();
    });
  });
  document.querySelectorAll('[data-catalog-delete]').forEach((button) => {
    button.addEventListener('click', () => handleCatalogDelete(Number(button.dataset.catalogDelete)));
  });
  document.querySelector('#catalog-form')?.addEventListener('submit', handleCatalogSubmit);
  initializeRouteMaps();
}

async function handleCatalogSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const id = Number(form.get('id') || 0);
  const payload = catalogPayload(state.catalogCollection, form);
  try {
    if (id) {
      await api.put(`/api/admin/catalog/${state.catalogCollection}/${id}`, payload);
      state.message = 'Запись справочника обновлена';
    } else {
      await api.post(`/api/admin/catalog/${state.catalogCollection}`, payload);
      state.message = 'Новая запись добавлена';
    }
    state.catalogEditing = null;
    await loadBase();
    render();
  } catch (error) {
    state.message = error.message;
    render();
  }
}

async function handleCatalogDelete(id) {
  const item = state.catalog[state.catalogCollection].find((entry) => entry.id === id);
  if (!item || !window.confirm(`Удалить "${item.name}"?`)) return;
  try {
    await api.delete(`/api/admin/catalog/${state.catalogCollection}/${id}`);
    state.message = 'Запись удалена';
    await loadBase();
    render();
  } catch (error) {
    state.message = error.message;
    render();
  }
}

async function handleTourSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.loading = true;
  state.message = '';
  render();

  try {
    const payload = Object.fromEntries(form.entries());
    payload.overnight = form.has('overnight');
    payload.groupSize = Number(payload.groupSize);
    payload.durationHours = Number(payload.durationHours);
    const result = await api.post('/api/tours/plan', payload);
    state.currentTour = result.tour;
    await loadBase();
  } catch (err) {
    state.message = err.message;
  } finally {
    state.loading = false;
    render();
  }
}

function fillBusinessDemo() {
  const form = document.querySelector('#tour-form');
  form.city.value = 'Пермь';
  form.groupType.value = 'business';
  form.groupSize.value = '24';
  form.durationHours.value = '7';
  form.goal.value = 'business';
  form.interests.value = 'обмен опытом, индустриальный парк, встреча с резидентами';
  form.meetingPoint.value = 'г. Пермь, ул. Ленина, 1';
  form.overnight.checked = true;
}

async function handleSelectionSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const enterpriseIds = form.getAll('enterpriseIds').map(Number);
  if (!enterpriseIds.length) {
    state.message = 'Выберите хотя бы одно предприятие';
    render();
    return;
  }
  const payload = {
    enterpriseIds,
    foodId: form.get('foodId') ? Number(form.get('foodId')) : null,
    transportId: Number(form.get('transportId')),
    accommodationId: form.get('accommodationId') ? Number(form.get('accommodationId')) : null
  };
  const result = await api.put(`/api/tours/${state.currentTour.id}/selection`, payload);
  state.currentTour = result.tour;
  await loadBase();
  state.message = 'Тур пересчитан и сохранён';
  render();
}

async function handleAiSubmit(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  await api.put('/api/admin/ai-creds', payload);
  state.aiCreds = null;
  state.aiTestResult = null;
  state.message = 'Настройки AI сохранены';
  render();
}

async function handleAiTest() {
  state.aiTesting = true;
  state.aiTestResult = null;
  render();
  try {
    state.aiTestResult = await api.post('/api/admin/ai-test', {});
  } catch (err) {
    state.aiTestResult = { ok: false, message: err.message };
  } finally {
    state.aiTesting = false;
    render();
  }
}

async function loadPublicTour(code) {
  try {
    const result = await api.get(`/api/public/tours/${code}`);
    state.publicTour = result.tour;
    renderPublic();
  } catch (err) {
    document.querySelector('#app').innerHTML = `<div class="public-page"><div class="empty">${escapeHtml(err.message)}</div></div>`;
  }
}

function renderPublic() {
  const tour = state.publicTour;
  document.querySelector('#app').innerHTML = `
    <main class="public-page">
      <header class="public-header">
        <h1>Промышленный тур: ${escapeHtml(tour.request.city)}</h1>
        <p class="muted">${groupLabel(tour.request.groupType)}, ${tour.request.groupSize} человек, ${tour.request.durationHours} часов. Цель: ${goalLabel(tour.request.goal)}.</p>
      </header>
      <section class="panel">
        ${renderMetrics(tour)}
        <h2>Маршрут</h2>
        ${renderRoute(tour)}
        <h2>Программа</h2>
        ${renderTimeline(tour.program)}
        <h2>Стоимость</h2>
        <p>${rub(tour.pricing.total)} на группу, ${rub(tour.pricing.perPerson)} на человека.</p>
      </section>
      <section class="panel booking-form" style="margin-top:16px">
        <h2>Забронировать и оплатить</h2>
        <form id="booking-form" class="form-grid">
          <div class="row">
            <div class="field"><label>Имя клиента</label><input name="customerName" required /></div>
            <div class="field"><label>Email</label><input name="email" type="email" required /></div>
          </div>
          <div class="field"><label>Телефон</label><input name="phone" /></div>
          <div class="actions">
            <button class="btn primary" type="submit">Забронировать</button>
            <button class="btn ghost" type="button" data-public-print>Скачать PDF</button>
          </div>
        </form>
      </section>
    </main>
  `;
  document.querySelector('#booking-form').addEventListener('submit', handleBookingSubmit);
  document.querySelector('[data-public-print]').addEventListener('click', () => window.print());
  initializeRouteMaps();
}

async function handleBookingSubmit(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  const code = state.publicTour.publicCode;
  await api.post(`/api/public/tours/${code}/book`, payload);
  const result = await api.post(`/api/public/tours/${code}/pay/mock`, {});
  state.publicTour = result.tour;
  document.querySelector('.booking-form').innerHTML = `
    <h2>Бронирование подтверждено</h2>
    <p class="notice">Оплата эмулирована. Email-уведомление записано в системе как mock_sent.</p>
  `;
}

init().catch((err) => {
  document.querySelector('#app').innerHTML = `<div class="public-page"><div class="empty">${escapeHtml(err.message)}</div></div>`;
});
