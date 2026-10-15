/** A window opened from another one ("Open in a new window"): the same app without the top bar, showing one programme
    view (Gantt, Table...) with its own panels, kept in step with the window that opened it (state/windowSync.ts).
    The address says so: ?satellite=<group>&view=<programme view>. */
const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);

/** The group the window shares with the one that opened it (null: this is a normal window). */
export const SATELLITE_GROUP: string | null = params.get('satellite');
export const IS_SATELLITE = SATELLITE_GROUP !== null;
/** The Programmes view the satellite opens on. */
const rawView = params.get('view');
/** The page the window opens on, when it is not the Programmes page (the view is written page:sequence, page:model…). */
export const SATELLITE_PAGE: string | null = rawView?.startsWith('page:') ? rawView.slice(5) : null;
export const SATELLITE_VIEW: string | null = rawView && !rawView.startsWith('page:') ? rawView : null;
/** Which of the windows its opener made this one is (the opener keeps where it is, to save it with the workspace). */
export const SATELLITE_ID: string | null = params.get('wid');

// The window says which it is in its title, so the two are easy to tell apart in the taskbar.
if (typeof document !== 'undefined') document.title = `Insight Plan - ${IS_SATELLITE ? 'Secondary' : 'Main'}`;
