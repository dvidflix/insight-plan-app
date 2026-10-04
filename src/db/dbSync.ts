import { addDbSyncer, closeProject, dbRoot, openProject, useProjectDbStore } from '../state/projectDbStore';
import { useLinkGroupsStore } from '../state/linkGroupsStore';
import { useTradeCapacityStore } from '../state/tradeCapacityStore';
import { refreshProject, reloadOrder, useScenarioStore } from '../state/scenarioStore';
import type { LinkGroup } from '../schedule/linkGroups';
import { fetchCapacities, fetchLinkGroups, fetchSettings, saveCapacities, saveLinkGroups, saveSetting } from './api';

/** Keeps the app's project data in the project database while one is open:
    link groups (ip_link_group), trade capacities (ip_trade_capacity) and
    the scenarios' start date (ip_setting). Opening a project, or "Reload
    from database", pulls them in; a change in the app is written back a
    moment later. The first time a database is opened, what the browser
    already has goes into it (when the database has none of its own); after
    that the database wins. Imported once, from main.tsx. */

const IMPORTED_KEY = 'app.browserDataImported';
const START_DATE_KEY = 'scenarios.startDate';

const report = (e: unknown) => useProjectDbStore.setState({ error: `Saving to the project database failed: ${e instanceof Error ? e.message : e}` });

/** Writes a store's slice to the database 400 ms after it changes, unless
    the change came from the database (apply). */
function mirror<T>(subscribe: (fn: () => void) => void, select: () => T, push: (root: string, value: T) => Promise<unknown>) {
  let applying = false;
  let last = select();
  let timer: ReturnType<typeof setTimeout> | null = null;
  subscribe(() => {
    const value = select();
    if (value === last) return;
    last = value;
    if (applying) return;
    const root = dbRoot();
    if (!root) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (dbRoot() === root) push(root, select()).catch(report);
    }, 400);
  });
  return (fn: () => void) => {
    applying = true;
    try {
      fn();
    } finally {
      last = select();
      applying = false;
    }
  };
}

const applyGroups = mirror(
  (fn) => useLinkGroupsStore.subscribe(fn),
  () => useLinkGroupsStore.getState().groups,
  (root, groups) => saveLinkGroups(root, groups),
);
const applyCapacities = mirror(
  (fn) => useTradeCapacityStore.subscribe(fn),
  () => useTradeCapacityStore.getState().capacities,
  (root, capacities) => saveCapacities(root, capacities),
);
const applyStartDate = mirror(
  (fn) => useScenarioStore.subscribe(fn),
  () => useScenarioStore.getState().startDate,
  (root, startDate) => saveSetting(root, START_DATE_KEY, startDate || null),
);

addDbSyncer({
  pull: async (root, reason) => {
    const [groups, capacities, settings] = await Promise.all([fetchLinkGroups(root), fetchCapacities(root), fetchSettings(root)]);
    const firstOpen = !settings[IMPORTED_KEY];
    const local = {
      groups: useLinkGroupsStore.getState().groups,
      capacities: useTradeCapacityStore.getState().capacities,
      startDate: useScenarioStore.getState().startDate,
    };
    if (firstOpen && !groups.length && local.groups.length) await saveLinkGroups(root, local.groups);
    else applyGroups(() => useLinkGroupsStore.getState().replaceAll(groups as LinkGroup[]));
    if (firstOpen && !Object.keys(capacities).length && Object.keys(local.capacities).length) await saveCapacities(root, local.capacities);
    else applyCapacities(() => useTradeCapacityStore.setState({ capacities }));
    const startDate = settings[START_DATE_KEY];
    if (firstOpen && startDate === undefined && local.startDate) await saveSetting(root, START_DATE_KEY, local.startDate);
    else applyStartDate(() => useScenarioStore.setState({ startDate: typeof startDate === 'string' ? startDate : '' }));
    if (firstOpen) await saveSetting(root, IMPORTED_KEY, new Date().toISOString());

    // The scenario on screen: its order, links and crews as the database has them.
    if (reason === 'reload') {
      reloadOrder();
      await refreshProject(root);
    }
  },
});

// Open the project's database at start, and whenever the folder changes.
let openedRoot: string | null = null;
function openIfChanged() {
  const { root } = useProjectDbStore.getState();
  if (root === openedRoot) return;
  openedRoot = root;
  if (root.trim()) void openProject(root);
  else closeProject();
}
useProjectDbStore.subscribe(openIfChanged);
openIfChanged();
