import ExtensionsAPI from 'sn-extension-api';
import './style.css';

// --- Markdown parsing/serialization ---

function parseTransactions(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const rows = [];
  for (const line of lines) {
    const match = line.match(
      /^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*([0-9.,]+)\s*\|\s*(\S+)\s*\|\s*(.*?)\s*\|/
    );
    if (match) {
      rows.push({
        date: match[1],
        platform: match[2].trim(),
        asset: match[3].trim(),
        amount: parseFloat(match[4].replace(/,/g, '')),
        currency: match[5].trim(),
        notes: match[6].trim(),
      });
    }
  }
  return rows;
}

function pad(str, len) {
  const s = String(str);
  return s + ' '.repeat(Math.max(0, len - s.length));
}

function formatAmount(n) {
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

function serializeMarkdown(transactions) {
  let md = '# Investments\n\n## Transactions\n\n';

  if (transactions.length === 0) {
    md += '| Date       | Platform | Asset | Amount | Currency | Notes |\n';
    md += '| ---------- | -------- | ----- | ------ | -------- | ----- |\n';
    return md;
  }

  const dateW = 10;
  const platW = Math.max(8, ...transactions.map(t => t.platform.length));
  const assetW = Math.max(5, ...transactions.map(t => t.asset.length));
  const amtW = Math.max(6, ...transactions.map(t => formatAmount(t.amount).length));
  const curW = Math.max(8, ...transactions.map(t => t.currency.length));
  const notesW = Math.max(5, ...transactions.map(t => (t.notes || '').length));

  md += `| ${pad('Date', dateW)} | ${pad('Platform', platW)} | ${pad('Asset', assetW)} | ${pad('Amount', amtW)} | ${pad('Currency', curW)} | ${pad('Notes', notesW)} |\n`;
  md += `| ${'-'.repeat(dateW)} | ${'-'.repeat(platW)} | ${'-'.repeat(assetW)} | ${'-'.repeat(amtW)} | ${'-'.repeat(curW)} | ${'-'.repeat(notesW)} |\n`;

  for (const t of transactions) {
    md += `| ${pad(t.date, dateW)} | ${pad(t.platform, platW)} | ${pad(t.asset, assetW)} | ${pad(formatAmount(t.amount), amtW)} | ${pad(t.currency, curW)} | ${pad(t.notes || '', notesW)} |\n`;
  }

  return md;
}

// --- State ---

let transactions = [];
let editorKit = null;
let editingIndex = null;

// --- Summary computation ---

function computeSummary() {
  // Group by (asset, currency) and sum amounts
  const groups = {};
  for (const t of transactions) {
    const key = `${t.asset}||${t.currency}`;
    groups[key] = (groups[key] || 0) + t.amount;
  }

  // Per-asset pills
  const assetPills = [];
  for (const [key, total] of Object.entries(groups)) {
    const [asset, currency] = key.split('||');
    assetPills.push({ asset, currency, total });
  }
  assetPills.sort((a, b) => a.asset.localeCompare(b.asset));

  // Grand total per currency
  const currencyTotals = {};
  for (const { currency, total } of assetPills) {
    currencyTotals[currency] = (currencyTotals[currency] || 0) + total;
  }

  return { assetPills, currencyTotals };
}

// --- Rendering ---

function getUnique(field) {
  const vals = new Set(transactions.map(t => t[field]));
  return [...vals].sort();
}

function renderSelectOptions() {
  const platformSel = document.getElementById('tx-platform');
  const assetSel = document.getElementById('tx-asset');
  const currencySel = document.getElementById('tx-currency');

  platformSel.innerHTML = getUnique('platform').map(v => `<option value="${v}">${v}</option>`).join('');
  assetSel.innerHTML = getUnique('asset').map(v => `<option value="${v}">${v}</option>`).join('');
  currencySel.innerHTML = getUnique('currency').map(v => `<option value="${v}">${v}</option>`).join('');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderTransactions() {
  const tbody = document.querySelector('#transactions-table tbody');
  tbody.innerHTML = transactions.map((t, i) => `
    <tr>
      <td>${t.date}</td>
      <td>${escapeHtml(t.platform)}</td>
      <td>${escapeHtml(t.asset)}</td>
      <td class="amount-cell">${t.amount.toLocaleString()}</td>
      <td>${escapeHtml(t.currency)}</td>
      <td>${escapeHtml(t.notes || '')}</td>
      <td><button class="btn btn-small btn-edit" data-action="edit" data-index="${i}">edit</button> <button class="btn btn-small btn-danger" data-action="delete" data-index="${i}">x</button></td>
    </tr>
  `).join('');
}

function renderSummary() {
  const el = document.getElementById('summary-pills');
  if (transactions.length === 0) { el.innerHTML = ''; return; }

  const { assetPills, currencyTotals } = computeSummary();

  let html = '<div class="summary-stats">';
  for (const { asset, currency, total } of assetPills) {
    html += `<span class="summary-pill">${escapeHtml(asset)}: <strong>${total.toLocaleString()} ${escapeHtml(currency)}</strong></span>`;
  }

  const totalParts = Object.entries(currencyTotals)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cur, total]) => `${total.toLocaleString()} ${escapeHtml(cur)}`)
    .join(' &middot; ');
  html += `<span class="summary-pill total-pill">Total: <strong>${totalParts}</strong></span>`;
  html += '</div>';
  el.innerHTML = html;
}

function render() {
  transactions.sort((a, b) => b.date.localeCompare(a.date));
  renderTransactions();
  renderSummary();
  renderSelectOptions();
}

// --- Save ---

function save() {
  const text = serializeMarkdown(transactions);
  if (editorKit) {
    editorKit.text = text;
  }
}

// --- Today helper ---

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// --- Event handlers ---

function setupEvents() {
  const addBtn = document.getElementById('add-transaction-btn');
  const form = document.getElementById('add-transaction-form');

  addBtn.addEventListener('click', () => {
    editingIndex = null;
    document.getElementById('save-transaction').textContent = 'Save';
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    document.getElementById('tx-date').value = todayStr();
    document.getElementById('new-platform').value = '';
    document.getElementById('new-asset').value = '';
    document.getElementById('tx-amount').value = '';
    document.getElementById('new-currency').value = '';
    document.getElementById('tx-notes').value = '';
    renderSelectOptions();
  });

  document.getElementById('cancel-transaction').addEventListener('click', () => {
    editingIndex = null;
    document.getElementById('save-transaction').textContent = 'Save';
    form.style.display = 'none';
  });

  document.getElementById('save-transaction').addEventListener('click', () => {
    const date = document.getElementById('tx-date').value;
    const newPlatform = document.getElementById('new-platform').value.trim();
    const platform = newPlatform || document.getElementById('tx-platform').value;
    const newAsset = document.getElementById('new-asset').value.trim();
    const asset = newAsset || document.getElementById('tx-asset').value;
    const amount = parseFloat(document.getElementById('tx-amount').value);
    const newCurrency = document.getElementById('new-currency').value.trim();
    const currency = newCurrency || document.getElementById('tx-currency').value;
    const notes = document.getElementById('tx-notes').value.trim();

    if (!date || !platform || !asset || !amount || !currency) return;

    const entry = { date, platform, asset, amount, currency, notes };

    if (editingIndex !== null) {
      transactions[editingIndex] = entry;
      editingIndex = null;
      document.getElementById('save-transaction').textContent = 'Save';
    } else {
      transactions.unshift(entry);
    }

    document.getElementById('new-platform').value = '';
    document.getElementById('new-asset').value = '';
    document.getElementById('tx-amount').value = '';
    document.getElementById('new-currency').value = '';
    document.getElementById('tx-notes').value = '';
    form.style.display = 'none';
    render();
    save();
  });

  // Table action buttons (event delegation)
  document.getElementById('transactions-table').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.index);

    if (btn.dataset.action === 'edit') {
      editingIndex = idx;
      const t = transactions[idx];
      document.getElementById('tx-date').value = t.date;
      renderSelectOptions();
      document.getElementById('tx-platform').value = t.platform;
      document.getElementById('new-platform').value = '';
      document.getElementById('tx-asset').value = t.asset;
      document.getElementById('new-asset').value = '';
      document.getElementById('tx-amount').value = t.amount;
      document.getElementById('tx-currency').value = t.currency;
      document.getElementById('new-currency').value = '';
      document.getElementById('tx-notes').value = t.notes || '';
      document.getElementById('save-transaction').textContent = 'Update';
      form.style.display = 'block';
    } else if (btn.dataset.action === 'delete') {
      transactions.splice(idx, 1);
      render();
      save();
    }
  });
}

// --- Init ---

function initExtension() {
  editorKit = ExtensionsAPI;
  editorKit.initialize();

  editorKit.subscribe((text) => {
    transactions = parseTransactions(text || '');
    render();
  });
}

function initDemo() {
  const demoText = `# Investments

## Transactions

| Date       | Platform | Asset  | Amount | Currency | Notes       |
| ---------- | -------- | ------ | ------ | -------- | ----------- |
| 2026-02-15 | ING      | VWCE   | 500    | EUR      | Monthly DCA |
| 2026-02-01 | XTB      | BTC    | 200    | USD      |             |
| 2026-01-15 | ING      | VWCE   | 500    | EUR      | Monthly DCA |
| 2026-01-10 | IBKR     | S&P500 | 1000   | USD      |             |
| 2026-01-05 | XTB      | BTC    | 300    | USD      |             |
`;

  transactions = parseTransactions(demoText);
  render();
}

setupEvents();

// Detect if running inside Standard Notes or standalone
if (window.parent !== window) {
  initExtension();
} else {
  initDemo();
}
