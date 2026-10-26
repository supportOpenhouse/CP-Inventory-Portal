/**
 * Channel Partner sync from Google Sheet → Openhouse CP Inventory Portal backend.
 *
 * Reads Sheet1 and POSTs to /api/sync/channel-partners. Column mapping is done
 * by HEADER NAME (row 1), so column order in the sheet doesn't matter and can
 * be reshuffled without breaking this script.
 *
 * Expected headers (case-insensitive, any order):
 *   name             → CP's full name
 *   phone_number     → phone (normalized to last 10 digits server-side)
 *   cp_code          → unique code (UNIQUE constraint in DB)
 *   company_name     → company
 *   city             → matched case-insensitively to cities.name
 *   micro_markets    → JSON array or comma-separated
 *
 * Any extra columns (id, created_at, etc.) are ignored.
 * Missing required headers (name, phone_number) abort the run with an error.
 *
 * Setup (one-time):
 *   1. Extensions → Apps Script → paste this whole file
 *   2. Project Settings → Script Properties → add:
 *        CP_SYNC_API_URL   = https://cp-inventory-portal.onrender.com/api/sync/channel-partners
 *        CP_SYNC_TOKEN     = (same value as SYNC_SECRET_TOKEN env var on Render)
 *   3. Run cpSyncFromSheet() once manually to authorize
 *   4. Triggers → Add Trigger → function: cpSyncFromSheet → day timer
 */

const CP_SYNC_SHEET_NAME = "Sheet1";
const CP_SYNC_BATCH_SIZE = 500;

// Required headers — script aborts if these aren't present.
const CP_SYNC_REQUIRED_HEADERS = ["name", "phone_number"];

// All headers we care about. Anything else in the sheet is ignored.
// Key = header name in sheet (case-insensitive); value = payload field sent to backend.
const CP_SYNC_HEADER_MAP = {
  "name":          "name",
  "phone_number":  "phone_number",
  "cp_code":       "cp_code",
  "company_name":  "company_name",
  "city":          "city",
  "micro_markets": "micro_markets",
};


function cpSyncFromSheet() {
  const cpSyncProps = PropertiesService.getScriptProperties();
  const cpSyncApiUrl = cpSyncProps.getProperty("CP_SYNC_API_URL");
  const cpSyncToken  = cpSyncProps.getProperty("CP_SYNC_TOKEN");

  if (!cpSyncApiUrl || !cpSyncToken) {
    throw new Error("Missing Script Properties CP_SYNC_API_URL or CP_SYNC_TOKEN. See script header for setup.");
  }

  const cpSyncSs = SpreadsheetApp.getActiveSpreadsheet();
  const cpSyncSheet = cpSyncSs.getSheetByName(CP_SYNC_SHEET_NAME);
  if (!cpSyncSheet) {
    throw new Error("Sheet not found: " + CP_SYNC_SHEET_NAME);
  }

  const cpSyncLastRow = cpSyncSheet.getLastRow();
  const cpSyncLastCol = cpSyncSheet.getLastColumn();
  if (cpSyncLastRow < 2) {
    Logger.log("Sheet has no data rows (only header or empty). Nothing to sync.");
    return;
  }

  // ===== 1. Read header row and build column-index map =====
  const cpSyncHeaderRow = cpSyncSheet.getRange(1, 1, 1, cpSyncLastCol).getValues()[0];
  const cpSyncColIdx = {};  // payload_field -> 0-based column index in the sheet
  for (let cpSyncHi = 0; cpSyncHi < cpSyncHeaderRow.length; cpSyncHi++) {
    const cpSyncHeaderVal = String(cpSyncHeaderRow[cpSyncHi] || "").trim().toLowerCase();
    if (cpSyncHeaderVal && cpSyncHeaderVal in CP_SYNC_HEADER_MAP) {
      const cpSyncPayloadKey = CP_SYNC_HEADER_MAP[cpSyncHeaderVal];
      cpSyncColIdx[cpSyncPayloadKey] = cpSyncHi;
    }
  }

  Logger.log("Header map resolved: " + JSON.stringify(cpSyncColIdx));

  // Validate required headers are present
  for (let cpSyncRi = 0; cpSyncRi < CP_SYNC_REQUIRED_HEADERS.length; cpSyncRi++) {
    const cpSyncReqKey = CP_SYNC_REQUIRED_HEADERS[cpSyncRi];
    if (!(cpSyncReqKey in cpSyncColIdx)) {
      throw new Error(
        "Required header missing in " + CP_SYNC_SHEET_NAME + ": '" + cpSyncReqKey + "'. " +
        "Found headers: " + JSON.stringify(cpSyncHeaderRow) + ". " +
        "Fix the sheet header row and re-run."
      );
    }
  }

  // ===== 2. Read all data rows =====
  const cpSyncValues = cpSyncSheet.getRange(2, 1, cpSyncLastRow - 1, cpSyncLastCol).getValues();
  Logger.log("Read " + cpSyncValues.length + " data rows from " + CP_SYNC_SHEET_NAME);

  // ===== 3. Shape each row using the header map =====
  const cpSyncPayloadRows = [];
  for (let cpSyncR = 0; cpSyncR < cpSyncValues.length; cpSyncR++) {
    const cpSyncRow = cpSyncValues[cpSyncR];

    // Skip fully-blank rows
    const cpSyncHasAny = cpSyncRow.some(function (v) {
      return v !== "" && v !== null && v !== undefined;
    });
    if (!cpSyncHasAny) continue;

    const cpSyncObj = {};
    const cpSyncFieldKeys = Object.keys(cpSyncColIdx);
    for (let cpSyncFki = 0; cpSyncFki < cpSyncFieldKeys.length; cpSyncFki++) {
      const cpSyncFieldKey = cpSyncFieldKeys[cpSyncFki];
      const cpSyncCi = cpSyncColIdx[cpSyncFieldKey];
      const cpSyncRaw = cpSyncRow[cpSyncCi];
      cpSyncObj[cpSyncFieldKey] = cpSyncRaw === null || cpSyncRaw === undefined
        ? ""
        : String(cpSyncRaw).trim();
    }
    cpSyncPayloadRows.push(cpSyncObj);
  }

  Logger.log("Prepared " + cpSyncPayloadRows.length + " non-empty rows to send.");

  // ===== 4. Send in batches =====
  let cpSyncTotalInserted = 0;
  let cpSyncTotalSkippedExisting = 0;
  let cpSyncTotalSkippedInvalid = 0;
  const cpSyncAllAdded = [];
  const cpSyncAllInvalid = [];

  for (let cpSyncStart = 0; cpSyncStart < cpSyncPayloadRows.length; cpSyncStart += CP_SYNC_BATCH_SIZE) {
    const cpSyncBatch = cpSyncPayloadRows.slice(cpSyncStart, cpSyncStart + CP_SYNC_BATCH_SIZE);
    const cpSyncBatchNum = Math.floor(cpSyncStart / CP_SYNC_BATCH_SIZE) + 1;
    Logger.log("Sending batch " + cpSyncBatchNum + " (" + cpSyncBatch.length + " rows)…");

    const cpSyncResp = UrlFetchApp.fetch(cpSyncApiUrl, {
      method: "post",
      contentType: "application/json",
      headers: { "X-Sync-Token": cpSyncToken },
      payload: JSON.stringify({ rows: cpSyncBatch }),
      muteHttpExceptions: true,
    });

    const cpSyncHttpCode = cpSyncResp.getResponseCode();
    const cpSyncBody = cpSyncResp.getContentText();
    if (cpSyncHttpCode !== 200) {
      Logger.log("Batch FAILED (HTTP " + cpSyncHttpCode + "): " + cpSyncBody);
      throw new Error("CP sync failed at batch " + cpSyncBatchNum + " — HTTP " + cpSyncHttpCode);
    }

    const cpSyncJson = JSON.parse(cpSyncBody);
    cpSyncTotalInserted        += cpSyncJson.inserted         || 0;
    cpSyncTotalSkippedExisting += cpSyncJson.skipped_existing || 0;
    cpSyncTotalSkippedInvalid  += cpSyncJson.skipped_invalid  || 0;
    if (Array.isArray(cpSyncJson.added))   cpSyncAllAdded.push.apply(cpSyncAllAdded, cpSyncJson.added);
    if (Array.isArray(cpSyncJson.invalid)) cpSyncAllInvalid.push.apply(cpSyncAllInvalid, cpSyncJson.invalid);
  }

  // ===== 5. Summary log =====
  Logger.log("==================================================");
  Logger.log("CP Sync complete");
  Logger.log("  Sheet rows processed       : " + cpSyncPayloadRows.length);
  Logger.log("  NEW CPs inserted           : " + cpSyncTotalInserted);
  Logger.log("  Already existed (skipped)  : " + cpSyncTotalSkippedExisting);
  Logger.log("  Invalid / errored          : " + cpSyncTotalSkippedInvalid);
  Logger.log("==================================================");

  if (cpSyncAllAdded.length > 0) {
    Logger.log("");
    Logger.log("NEW CPs added this run:");
    for (let cpSyncI = 0; cpSyncI < cpSyncAllAdded.length; cpSyncI++) {
      const cpSyncA = cpSyncAllAdded[cpSyncI];
      Logger.log("  + cp_code=" + (cpSyncA.cp_code || "(none)") +
                 " | phone=" + cpSyncA.phone +
                 " | name=" + cpSyncA.name +
                 " | company=" + (cpSyncA.company || "(none)") +
                 " | city=" + (cpSyncA.city || "(none)"));
    }
  }

  if (cpSyncAllInvalid.length > 0) {
    Logger.log("");
    Logger.log("Invalid rows (NOT added):");
    for (let cpSyncJ = 0; cpSyncJ < cpSyncAllInvalid.length; cpSyncJ++) {
      const cpSyncInv = cpSyncAllInvalid[cpSyncJ];
      Logger.log("  x batch_index=" + cpSyncInv.row_index + " reason: " + cpSyncInv.reason);
    }
  }
}


/**
 * Dry run — read sheet, resolve column map, show first 5 rows as they would
 * be sent. Does NOT hit the backend. Use this to verify headers before syncing.
 */
function cpSyncDryRun() {
  const cpSyncDrySheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CP_SYNC_SHEET_NAME);
  if (!cpSyncDrySheet) {
    throw new Error("Sheet not found: " + CP_SYNC_SHEET_NAME);
  }
  const cpSyncDryLastRow = cpSyncDrySheet.getLastRow();
  const cpSyncDryLastCol = cpSyncDrySheet.getLastColumn();
  if (cpSyncDryLastRow < 2) {
    Logger.log("No data rows.");
    return;
  }

  const cpSyncDryHeader = cpSyncDrySheet.getRange(1, 1, 1, cpSyncDryLastCol).getValues()[0];
  const cpSyncDryColIdx = {};
  for (let cpSyncDHi = 0; cpSyncDHi < cpSyncDryHeader.length; cpSyncDHi++) {
    const cpSyncDryH = String(cpSyncDryHeader[cpSyncDHi] || "").trim().toLowerCase();
    if (cpSyncDryH && cpSyncDryH in CP_SYNC_HEADER_MAP) {
      cpSyncDryColIdx[CP_SYNC_HEADER_MAP[cpSyncDryH]] = cpSyncDHi;
    }
  }
  Logger.log("Headers found in sheet : " + JSON.stringify(cpSyncDryHeader));
  Logger.log("Resolved column map    : " + JSON.stringify(cpSyncDryColIdx));

  const cpSyncDryValues = cpSyncDrySheet.getRange(2, 1, Math.min(5, cpSyncDryLastRow - 1), cpSyncDryLastCol).getValues();
  Logger.log("First 5 rows that WOULD be sent:");
  for (let cpSyncDi = 0; cpSyncDi < cpSyncDryValues.length; cpSyncDi++) {
    const cpSyncDryRow = cpSyncDryValues[cpSyncDi];
    const cpSyncDryObj = {};
    const cpSyncDryKeys = Object.keys(cpSyncDryColIdx);
    for (let cpSyncDki = 0; cpSyncDki < cpSyncDryKeys.length; cpSyncDki++) {
      const cpSyncDk = cpSyncDryKeys[cpSyncDki];
      cpSyncDryObj[cpSyncDk] = String(cpSyncDryRow[cpSyncDryColIdx[cpSyncDk]] || "").trim();
    }
    Logger.log("  row " + (cpSyncDi + 2) + ": " + JSON.stringify(cpSyncDryObj));
  }
}
