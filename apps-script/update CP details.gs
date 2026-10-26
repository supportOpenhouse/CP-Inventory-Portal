/**
 * Channel Partner DETAILS update — Google Sheet → Openhouse CP Inventory Portal.
 *
 * Companion to "shift to Neon.gs". That script only ADDS new CPs: its endpoint
 * skips any phone already in the DB, so edits to existing CPs in the sheet are
 * never applied. This script applies them — name, email and city only — by
 * POSTing to /api/sync/channel-partners/update. Runs at 12 AM and 12 PM.
 *
 * How the server applies a row (backend/routes/sync.py, update_channel_partners):
 *   - Matched on phone (last 10 digits). CP accounts only — never an admin.
 *   - EMPTY cell = no information. It never erases a value in the DB.
 *   - city must be Noida / Gurgaon / Ghaziabad (any case); anything else is
 *     rejected, not written.
 *   - email must look like an address; stored lowercased.
 *   - A phone shared by two CP accounts is skipped and reported.
 *   - A row with any invalid value is skipped whole.
 *
 * Expected headers in Sheet1 (case-insensitive, any order, extras ignored):
 *   phone_number   → REQUIRED — the match key
 *   name / email / city → at least one; a missing column is simply not updated
 *
 * Setup (one-time):
 *   1. Add this as a NEW file in the SAME Apps Script project as
 *      "shift to Neon.gs". Every name here is prefixed CP_UPD_ / cpUpd: all .gs
 *      files in a project share one global scope, and a duplicate `const`
 *      would stop BOTH scripts from running.
 *   2. Project Settings → Script Properties → add:
 *        CP_UPDATE_API_URL = https://cp-inventory-portal.onrender.com/api/sync/channel-partners/update
 *      (CP_SYNC_TOKEN is reused from "shift to Neon.gs" — same secret.)
 *   3. Project Settings → Time zone → (GMT+05:30) India Standard Time.
 *      Trigger hours are read in the PROJECT's time zone.
 *   4. Run cpUpdateDryRun() and read the log: it shows every change the real
 *      run would make, without writing anything.
 *   5. Run cpUpdateInstallTriggers() once.
 *
 * Triggers fire within ±15 minutes of 12:00 AM and 12:00 PM — Apps Script
 * can't schedule an exact minute.
 */

const CP_UPD_SHEET_NAME = "Sheet1";
const CP_UPD_BATCH_SIZE = 500;   // server caps at 1000
const CP_UPD_KEY_HEADER = "phone_number";
const CP_UPD_FIELD_HEADERS = ["name", "email", "city"];


/** Real run — what the triggers call. */
function cpUpdateFromSheet() {
  cpUpdRun_(false);
}

/** Dry run — the server computes every change and rolls back. Nothing written. */
function cpUpdateDryRun() {
  cpUpdRun_(true);
}

/**
 * Schedule cpUpdateFromSheet daily at 12 AM and 12 PM. Safe to re-run: it
 * replaces ONLY this script's own triggers — "shift to Neon.gs"'s trigger
 * (cpSyncFromSheet) lives in the same project and is left alone.
 */
function cpUpdateInstallTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === "cpUpdateFromSheet"; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger("cpUpdateFromSheet").timeBased().everyDays(1).atHour(0).nearMinute(0).create();
  ScriptApp.newTrigger("cpUpdateFromSheet").timeBased().everyDays(1).atHour(12).nearMinute(0).create();
  Logger.log("Installed: cpUpdateFromSheet daily at ~12 AM and ~12 PM (" + Session.getScriptTimeZone() + ").");
}


function cpUpdRun_(cpUpdDry) {
  const cpUpdProps = PropertiesService.getScriptProperties();
  const cpUpdApiUrl = cpUpdProps.getProperty("CP_UPDATE_API_URL");
  const cpUpdToken  = cpUpdProps.getProperty("CP_SYNC_TOKEN");
  if (!cpUpdApiUrl || !cpUpdToken) {
    throw new Error("Missing Script Properties CP_UPDATE_API_URL or CP_SYNC_TOKEN. See script header for setup.");
  }

  const cpUpdSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CP_UPD_SHEET_NAME);
  if (!cpUpdSheet) throw new Error("Sheet not found: " + CP_UPD_SHEET_NAME);
  const cpUpdLastRow = cpUpdSheet.getLastRow();
  const cpUpdLastCol = cpUpdSheet.getLastColumn();
  if (cpUpdLastRow < 2) {
    Logger.log("Sheet has no data rows. Nothing to update.");
    return;
  }

  // ===== 1. Header → column index =====
  const cpUpdHeader = cpUpdSheet.getRange(1, 1, 1, cpUpdLastCol).getValues()[0]
    .map(function (h) { return String(h || "").trim().toLowerCase(); });
  const cpUpdKeyCol = cpUpdHeader.indexOf(CP_UPD_KEY_HEADER);
  if (cpUpdKeyCol === -1) {
    throw new Error("Required header missing in " + CP_UPD_SHEET_NAME + ": '" + CP_UPD_KEY_HEADER + "'.");
  }
  const cpUpdFieldCols = {};  // field -> column index, only for headers present
  CP_UPD_FIELD_HEADERS.forEach(function (f) {
    const ci = cpUpdHeader.indexOf(f);
    if (ci !== -1) cpUpdFieldCols[f] = ci;
  });
  if (Object.keys(cpUpdFieldCols).length === 0) {
    throw new Error("None of " + JSON.stringify(CP_UPD_FIELD_HEADERS) + " found in the header row — nothing to update.");
  }
  Logger.log("Updating fields: " + Object.keys(cpUpdFieldCols).join(", ") +
             (cpUpdDry ? "   [DRY RUN — nothing will be written]" : ""));

  // ===== 2. Shape rows, de-duplicating phones across the WHOLE sheet =====
  // The server only ever sees one batch, so it can't spot a phone repeated in
  // two batches. Two rows for one phone would apply in whichever order the
  // batches land — so the first occurrence wins and later ones are reported.
  const cpUpdValues = cpUpdSheet.getRange(2, 1, cpUpdLastRow - 1, cpUpdLastCol).getValues();
  const cpUpdRows = [];
  const cpUpdSheetRow = [];   // parallel to cpUpdRows: the sheet row number
  const cpUpdSeen = {};       // last-10-digits phone -> first sheet row
  const cpUpdDupes = [];
  for (let r = 0; r < cpUpdValues.length; r++) {
    const row = cpUpdValues[r];
    const sheetRow = r + 2;
    const phoneRaw = String(row[cpUpdKeyCol] === null || row[cpUpdKeyCol] === undefined ? "" : row[cpUpdKeyCol]).trim();
    if (!phoneRaw) continue;  // no key → nothing to match on

    const phoneKey = phoneRaw.replace(/\D/g, "").slice(-10);
    if (phoneKey && cpUpdSeen[phoneKey]) {
      cpUpdDupes.push("row " + sheetRow + " repeats phone " + phoneKey + " (first at row " + cpUpdSeen[phoneKey] + ")");
      continue;
    }
    if (phoneKey) cpUpdSeen[phoneKey] = sheetRow;

    const obj = { phone_number: phoneRaw };
    Object.keys(cpUpdFieldCols).forEach(function (f) {
      const v = row[cpUpdFieldCols[f]];
      obj[f] = v === null || v === undefined ? "" : String(v).trim();
    });
    cpUpdRows.push(obj);
    cpUpdSheetRow.push(sheetRow);
  }
  Logger.log("Prepared " + cpUpdRows.length + " rows (" + cpUpdDupes.length + " duplicate phones held back).");

  // ===== 3. Send in batches =====
  let cpUpdUpdated = 0, cpUpdUnchanged = 0, cpUpdNotFound = 0, cpUpdInvalidN = 0, cpUpdCityIdFilled = 0;
  const cpUpdChanges = [], cpUpdInvalid = [], cpUpdMissing = [];

  for (let start = 0; start < cpUpdRows.length; start += CP_UPD_BATCH_SIZE) {
    const batch = cpUpdRows.slice(start, start + CP_UPD_BATCH_SIZE);
    const batchNum = Math.floor(start / CP_UPD_BATCH_SIZE) + 1;
    const resp = UrlFetchApp.fetch(cpUpdApiUrl, {
      method: "post",
      contentType: "application/json",
      headers: { "X-Sync-Token": cpUpdToken },
      payload: JSON.stringify({ rows: batch, dry_run: cpUpdDry }),
      muteHttpExceptions: true,
    });
    const code = resp.getResponseCode();
    const body = resp.getContentText();
    if (code !== 200) {
      Logger.log("Batch " + batchNum + " FAILED (HTTP " + code + "): " + body);
      // Throwing makes a trigger run fail visibly — Apps Script emails the owner.
      throw new Error("CP update failed at batch " + batchNum + " — HTTP " + code);
    }

    // row_index is relative to this batch — translate back to the sheet row.
    const json = JSON.parse(body);
    const toSheetRow = function (idx) { return cpUpdSheetRow[start + idx]; };
    cpUpdUpdated      += json.updated;
    cpUpdUnchanged    += json.unchanged;
    cpUpdNotFound     += json.not_found;
    cpUpdInvalidN     += json.skipped_invalid;
    cpUpdCityIdFilled += json.city_id_filled;
    json.changes.forEach(function (c) { cpUpdChanges.push({ sheetRow: toSheetRow(c.row_index), c: c }); });
    json.invalid.forEach(function (x) { cpUpdInvalid.push("row " + toSheetRow(x.row_index) + ": " + x.reason); });
    json.not_found_rows.forEach(function (i) { cpUpdMissing.push(toSheetRow(i)); });
  }

  // ===== 4. Summary =====
  Logger.log("==================================================");
  Logger.log("CP details update " + (cpUpdDry ? "DRY RUN" : "complete"));
  Logger.log("  Rows sent               : " + cpUpdRows.length);
  Logger.log("  " + (cpUpdDry ? "WOULD update" : "Updated     ") + "            : " + cpUpdUpdated);
  Logger.log("  Already up to date      : " + cpUpdUnchanged);
  Logger.log("  city_id filled in       : " + cpUpdCityIdFilled);
  Logger.log("  Phone not found (no CP) : " + cpUpdNotFound);
  Logger.log("  Invalid (skipped)       : " + cpUpdInvalidN);
  Logger.log("  Duplicate phones (held) : " + cpUpdDupes.length);
  Logger.log("==================================================");

  if (cpUpdChanges.length) {
    Logger.log("");
    Logger.log(cpUpdDry ? "Changes that WOULD be made:" : "Changes made:");
    cpUpdChanges.forEach(function (x) {
      const parts = Object.keys(x.c.fields).map(function (f) {
        const v = x.c.fields[f];
        return f + ": \"" + (v[0] === null ? "" : v[0]) + "\" → \"" + v[1] + "\"";
      });
      Logger.log("  ~ row " + x.sheetRow + " " + (x.c.cp_code || "(no code)") + " | " + parts.join(" | "));
    });
  }
  if (cpUpdInvalid.length) {
    Logger.log("");
    Logger.log("Invalid rows (NOT applied):");
    cpUpdInvalid.forEach(function (s) { Logger.log("  x " + s); });
  }
  if (cpUpdDupes.length) {
    Logger.log("");
    Logger.log("Duplicate phones in the sheet (only the first row was sent):");
    cpUpdDupes.forEach(function (s) { Logger.log("  = " + s); });
  }
  if (cpUpdMissing.length) {
    Logger.log("");
    Logger.log("Phones with no matching CP (rows): " + cpUpdMissing.join(", "));
  }
}
