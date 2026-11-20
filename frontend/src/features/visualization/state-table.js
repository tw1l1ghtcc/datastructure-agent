export function createStateTable(title, columns, rows) {
  const element = document.createElement('table');
  element.className = 'uf-table';
  element.createCaption().textContent = title;
  const head = element.createTHead().insertRow();
  for (const name of columns) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = name;
    head.append(cell);
  }
  const body = element.createTBody();
  for (const values of rows) {
    const row = body.insertRow();
    for (const value of values) row.insertCell().textContent = value ?? '空';
  }
  return element;
}
