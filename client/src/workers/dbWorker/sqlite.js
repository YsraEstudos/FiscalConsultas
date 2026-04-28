import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

import { clearSearchCache, closeWorkerDb, getSqliteApi, setSqliteApi, setWorkerDb, setWorkerVersion } from "./state.js";

export async function initSqlite() {
  const existingApi = getSqliteApi();
  if (existingApi) return existingApi;

  const sqlite3Api = await sqlite3InitModule({
    print: () => {},
    printErr: () => {},
  });
  setSqliteApi(sqlite3Api);
  return sqlite3Api;
}

/**
 * @param {Uint8Array} dbBytes
 */
export async function loadDatabaseFromBytes(dbBytes) {
  const sqlite3 = await initSqlite();
  const oo = sqlite3.oo1;

  closeWorkerDb();

  const nextDb = new oo.DB(":memory:");
  const pDb = nextDb.pointer;
  if (!pDb) {
    nextDb.close();
    throw new Error("Failed to get DB pointer");
  }

  const rc = sqlite3.capi.sqlite3_deserialize(
    pDb,
    "main",
    sqlite3.wasm.allocFromTypedArray(dbBytes),
    dbBytes.length,
    dbBytes.length,
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
      sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE
  );

  if (rc !== 0) {
    nextDb.close();
    throw new Error(`sqlite3_deserialize failed with code ${rc}`);
  }

  nextDb.exec("PRAGMA cache_size = -4000");
  nextDb.exec("PRAGMA temp_store = MEMORY");

  const testResult = nextDb.exec(
    "SELECT value FROM db_metadata WHERE key='version'",
    {
      returnValue: "resultRows",
    }
  );
  if (testResult && testResult.length > 0) {
    setWorkerVersion(testResult[0][0]);
  }

  setWorkerDb(nextDb);
  clearSearchCache();
}
