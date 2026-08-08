// report_screenshots join table — attaches, detaches, reorders, lists.
// Per CONTEXT.md D-07 + RPT-03.
//
// Composite PK (report_id, screenshot_id) guarantees one row per attached
// screenshot; the (report_id, sort_order) index drives the PDF render
// query (ORDER BY sort_order ASC) so the PDF walks attached screenshots
// in display order. FK ON DELETE CASCADE means deleting a `reports` row
// or its underlying `screenshots` row cleans up the join row.

import type Database from 'better-sqlite3';
import { getDb } from './index';

export type ReportScreenshotRow = {
  report_id: string;
  screenshot_id: number;
  sort_order: number;
};

type Stmt = Database.Statement;

let cached: {
  attach: Stmt;
  detach: Stmt;
  updateOrder: Stmt;
  listByReport: Stmt;
} | null = null;

function stmts(): NonNullable<typeof cached> {
  if (cached) return cached;
  const db = getDb();
  cached = {
    // INSERT OR REPLACE so re-attaching an existing screenshot at a new
    // sort_order updates in place instead of violating the PK.
    attach: db.prepare(
      `INSERT OR REPLACE INTO report_screenshots (report_id, screenshot_id, sort_order)
       VALUES (@report_id, @screenshot_id, @sort_order)`,
    ),
    detach: db.prepare(
      `DELETE FROM report_screenshots WHERE report_id = ? AND screenshot_id = ?`,
    ),
    updateOrder: db.prepare(
      `UPDATE report_screenshots SET sort_order = ? WHERE report_id = ? AND screenshot_id = ?`,
    ),
    listByReport: db.prepare(
      `SELECT report_id, screenshot_id, sort_order
       FROM report_screenshots
       WHERE report_id = ?
       ORDER BY sort_order ASC`,
    ),
  };
  return cached;
}

// ponytail: tests swap DB instances between cases, so cached statements
// must be dropped on teardown.
export function __resetReportScreenshotsRepoCache(): void {
  cached = null;
}

function rowToReportScreenshot(row: ReportScreenshotRow): ReportScreenshotRow {
  return {
    report_id: row.report_id,
    screenshot_id: row.screenshot_id,
    sort_order: row.sort_order,
  };
}

export const reportScreenshotsRepo = {
  attach(reportId: string, screenshotId: number, sortOrder: number): void {
    stmts().attach.run({
      report_id: reportId,
      screenshot_id: screenshotId,
      sort_order: sortOrder,
    });
  },

  detach(reportId: string, screenshotId: number): void {
    stmts().detach.run(reportId, screenshotId);
  },

  // ponytail: atomic reorder — better-sqlite3 transactions are synchronous
  // and cheap, so the doctor's drag-to-reorder IPC handler can call this
  // without locking concerns. The whole batch either commits or rolls back.
  reorder(reportId: string, orderedIds: number[]): void {
    const db = getDb();
    const txn = db.transaction((ids: number[]) => {
      const updateOrder = stmts().updateOrder;
      ids.forEach((screenshotId, index) => {
        updateOrder.run(index, reportId, screenshotId);
      });
    });
    txn(orderedIds);
  },

  listByReport(reportId: string): ReportScreenshotRow[] {
    return (stmts().listByReport.all(reportId) as ReportScreenshotRow[]).map(rowToReportScreenshot);
  },
};
