import { getWorkerDb } from "./state.js";

export function fetchAll(sql, bind = []) {
  const db = getWorkerDb();
  if (!db) return [];
  return (
    db.exec(sql, {
      bind,
      returnValue: "resultRows",
      rowMode: "object",
    }) || []
  );
}

export function fetchOne(sql, bind = []) {
  const rows = fetchAll(sql, bind);
  return rows[0] || null;
}

export function queryResultRows(sql, bind = []) {
  try {
    return fetchAll(sql, bind);
  } catch {
    return [];
  }
}

export function queryFirstOptionalRow(sql, bind = []) {
  const rows = queryResultRows(sql, bind);
  return rows.length > 0 ? rows[0] : null;
}
