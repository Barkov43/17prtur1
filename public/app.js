const state = {
  tab: 'builder',
  catalog: null,
  tours: [],
  currentTour: null,
  publicTour: null,
  aiCreds: null,
  aiTestResult: null,
  aiTesting: false,
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
  put(path, body) { return this.request('PUT', path, body); }
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
  await loadBase();
  render();
}

function render() {
  document.querySelector('#app').innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <strong>Нейросети в промышленном туризме</strong>
          <span>MVP для сборки промышленного тура под группу за 5-10 минут</span>
        </div>
        <nav class="nav">
          ${navButton('builder', 'Сборка тура')}
          ${navButton('tours', 'Созданные туры')}
          ${navButton('catalog', 'Справочники')}
          ${navButton('ai', 'AI настройки')}
        </nav>
      </aside>
      <main class="main">
        ${renderTopbar()}
        ${state.message ? `<div class="notice">${escapeHtml(state.message)}</div>` : ''}
        ${state.tab === 'builder' ? renderBuilder() : ''}
        ${state.tab === 'tours' ? renderTours() : ''}
        ${state.tab === 'catalog' ? renderCatalog() : ''}
        ${state.tab === 'ai' ? renderAiSettings() : ''}
      </main>
    </div>
  `;
  bindEvents();
}

function navButton(tab, label) {
  return `<button data-tab="${tab}" class="${state.tab === tab ? 'active' : ''}">${label}</button>`;
}

function renderTopbar() {
  const title = {
    builder: 'Сборка нового тура',
    tours: 'Созданные предложения',
    catalog: 'Справочники маршрутизации',
    ai: 'Настройки внутренней LLM'
  }[state.tab];
  const subtitle = {
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
  return `
    <div class="route-map">
      ${tour.route.points.map((point, index) => `
        <span class="route-point">${escapeHtml(point)}</span>
        ${index < tour.route.points.length - 1 ? '<span class="arrow">→</span>' : ''}
      `).join('')}
    </div>
  `;
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
  return `
    <div class="cards">
      ${catalogSection('Предприятия', state.catalog.enterprises, (item) => `${item.city}, ${item.industry}. ${item.durationMinutes} мин, вместимость ${item.capacity}`)}
      ${catalogSection('Питание', state.catalog.foodPlaces, (item) => `${item.city}, ${item.type}, ${rub(item.pricePerPerson)} / чел., ${item.capacity} мест`)}
      ${catalogSection('Размещение', state.catalog.accommodations, (item) => `${item.city}, ${item.type}, ${rub(item.pricePerPerson)} / чел., ${item.capacity} мест`)}
      ${catalogSection('Транспорт', state.catalog.transportCompanies, (item) => `${item.city}, ${item.transportType}, ${item.capacity} мест, ${rub(item.pricePerHour)} / час`)}
    </div>
  `;
}

function catalogSection(title, items, meta) {
  return `
    <section class="panel">
      <h2>${title}</h2>
      <div class="cards">
        ${items.map((item) => `
          <article class="card">
            <h3>${escapeHtml(item.name)}</h3>
            <p>${escapeHtml(meta(item))}</p>
          </article>
        `).join('')}
      </div>
    </section>
  `;
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
      render();
    });
  });

  document.querySelector('#tour-form')?.addEventListener('submit', handleTourSubmit);
  document.querySelector('[data-demo]')?.addEventListener('click', fillBusinessDemo);
  document.querySelector('#selection-form')?.addEventListener('submit', handleSelectionSubmit);
  document.querySelector('[data-print]')?.addEventListener('click', () => window.print());
  document.querySelector('#ai-form')?.addEventListener('submit', handleAiSubmit);
  document.querySelector('[data-ai-test]')?.addEventListener('click', handleAiTest);
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
  form.meetingPoint.value = 'г. Киров, ул. Ленина, 1';
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
