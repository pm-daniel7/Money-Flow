/**
 * Reusable Smart Date Input + Custom Dark Calendar Popover
 * Allows typing dates manually (YYYY-MM-DD, DD/MM/YYYY, "25 Nov", "yesterday", etc.)
 * OR picking visually from a calendar grid popup.
 */

const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function toIso(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseFlexibleDate(raw, refDate = new Date()) {
  const txt = String(raw || '').trim();
  if (!txt) return null;
  const low = txt.toLowerCase();

  if (low === 'today') {
    return toIso(refDate.getFullYear(), refDate.getMonth() + 1, refDate.getDate());
  }
  if (low === 'yesterday') {
    const ydt = new Date(refDate);
    ydt.setDate(ydt.getDate() - 1);
    return toIso(ydt.getFullYear(), ydt.getMonth() + 1, ydt.getDate());
  }

  // YYYY-MM-DD or YYYY/MM/DD
  let m = txt.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m) return toIso(Number(m[1]), Number(m[2]), Number(m[3]));

  // DD/MM/YYYY or DD-MM-YYYY
  m = txt.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return toIso(Number(m[3]), Number(m[2]), Number(m[1]));

  // DD/MM or DD-MM (current year)
  m = txt.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (m) return toIso(refDate.getFullYear(), Number(m[2]), Number(m[1]));

  // DD MMM [YYYY] (e.g. "25 Nov", "25 Nov 2026")
  m = txt.match(/^(\d{1,2})[\s\-]+([A-Za-z]{3,9})(?:[\s,\-]+(\d{4}))?$/);
  if (m) {
    const mo = MONTHS_SHORT.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    const yr = m[3] ? Number(m[3]) : refDate.getFullYear();
    if (mo >= 1) return toIso(yr, mo, Number(m[1]));
  }

  // MMM DD [YYYY] (e.g. "Nov 25", "Nov 25, 2026")
  m = txt.match(/^([A-Za-z]{3,9})[\s\-]+(\d{1,2})(?:[\s,\-]+(\d{4}))?$/);
  if (m) {
    const mo = MONTHS_SHORT.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    const yr = m[3] ? Number(m[3]) : refDate.getFullYear();
    if (mo >= 1) return toIso(yr, mo, Number(m[2]));
  }

  return null;
}

export function renderDateFieldHtml(id, initialIso) {
  return `
    <div class="date-field-wrap" data-date-wrap="${id}">
      <div class="date-input-row">
        <input id="${id}" class="date-text-input mono" type="text" value="${initialIso}" placeholder="YYYY-MM-DD or 25/11/2026" autocomplete="off" />
        <button type="button" class="btn btn-ghost btn-sm date-cal-btn" id="${id}-btn" aria-label="Open calendar" title="Choose on calendar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
        </button>
      </div>
      <div id="${id}-cal" class="calendar-popover hidden"></div>
    </div>
  `;
}

export function bindDateField(container, id) {
  const input = container.querySelector(`#${id}`);
  const toggleBtn = container.querySelector(`#${id}-btn`);
  const popover = container.querySelector(`#${id}-cal`);

  const todayIso = new Date().toISOString().slice(0, 10);
  const initParsed = parseFlexibleDate(input.value) || todayIso;
  let viewYear = Number(initParsed.slice(0, 4));
  let viewMonth = Number(initParsed.slice(5, 7)); // 1..12

  const renderCal = () => {
    const selectedIso = parseFlexibleDate(input.value);
    const monthTitle = new Date(viewYear, viewMonth - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const firstDow = new Date(viewYear, viewMonth - 1, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();

    const blanks = Array.from({ length: firstDow }, () => '<span></span>').join('');
    const days = Array.from({ length: daysInMonth }, (_, i) => {
      const d = i + 1;
      const iso = toIso(viewYear, viewMonth, d);
      const isSelected = iso === selectedIso;
      const isToday = iso === todayIso;
      return `<button type="button" class="cal-day ${isSelected ? 'is-selected' : ''} ${isToday ? 'is-today' : ''}" data-cal-iso="${iso}">${d}</button>`;
    }).join('');

    popover.innerHTML = `
      <div class="cal-header">
        <button type="button" class="icon-btn" data-cal-nav="-1" aria-label="Previous month">‹</button>
        <strong class="cal-month-title">${monthTitle}</strong>
        <button type="button" class="icon-btn" data-cal-nav="1" aria-label="Next month">›</button>
      </div>
      <div class="cal-weekdays">
        <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
      </div>
      <div class="cal-grid">${blanks}${days}</div>
      <div class="cal-footer">
        <button type="button" class="btn btn-ghost btn-sm" data-cal-quick="today">Today</button>
        <button type="button" class="btn btn-ghost btn-sm" data-cal-quick="yesterday">Yesterday</button>
      </div>
    `;

    popover.querySelectorAll('[data-cal-nav]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        viewMonth += Number(btn.dataset.calNav);
        if (viewMonth < 1) { viewMonth = 12; viewYear--; }
        if (viewMonth > 12) { viewMonth = 1; viewYear++; }
        renderCal();
      };
    });

    popover.querySelectorAll('[data-cal-iso]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        input.value = btn.dataset.calIso;
        input.classList.remove('input-invalid');
        popover.classList.add('hidden');
      };
    });

    popover.querySelectorAll('[data-cal-quick]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const iso = parseFlexibleDate(btn.dataset.calQuick);
        if (iso) {
          input.value = iso;
          input.classList.remove('input-invalid');
          viewYear = Number(iso.slice(0, 4));
          viewMonth = Number(iso.slice(5, 7));
        }
        popover.classList.add('hidden');
      };
    });
  };

  toggleBtn.onclick = (e) => {
    e.stopPropagation();
    const parsed = parseFlexibleDate(input.value);
    if (parsed) {
      viewYear = Number(parsed.slice(0, 4));
      viewMonth = Number(parsed.slice(5, 7));
    }
    const willOpen = popover.classList.contains('hidden');
    if (willOpen) {
      renderCal();
      popover.classList.remove('hidden');
    } else {
      popover.classList.add('hidden');
    }
  };

  input.oninput = () => {
    const valid = parseFlexibleDate(input.value);
    input.classList.toggle('input-invalid', Boolean(input.value.trim()) && !valid);
  };

  input.onblur = () => {
    const parsed = parseFlexibleDate(input.value);
    if (parsed) {
      input.value = parsed;
      input.classList.remove('input-invalid');
    }
  };

  // Close calendar when clicking elsewhere inside modal
  container.addEventListener('click', (e) => {
    if (!e.target.closest(`[data-date-wrap="${id}"]`)) {
      popover.classList.add('hidden');
    }
  });

  return {
    getValue() {
      const parsed = parseFlexibleDate(input.value);
      if (!parsed) input.classList.add('input-invalid');
      return parsed;
    }
  };
}
