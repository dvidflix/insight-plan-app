/** A window opened from another one ("Open in a new window"): the same app without the top bar, showing one programme
    view (Gantt, Table...) with its own panels, kept in step with the window that opened it (state/windowSync.ts).
    The address says so: ?satellite=<group>&view=<programme view>. */
const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);

/** The group the window shares with the one that opened it (null: this is a normal window). */
export const SATELLITE_GROUP: string | null = params.get('satellite');
export const IS_SATELLITE = SATELLITE_GROUP !== null;
/** The Programmes view the satellite opens on. */
export const SATELLITE_VIEW: string | null = params.get('view');
