import { describe, expect, it } from 'vitest';
import { isDataKey, isLayoutKey } from '../../src/state/scenes';

// A scene is a snapshot of the browser's keys: layout keys travel with it, data keys are its own lists, the rest are not kept.
const layout = (k: string) => isLayoutKey(k) && !isDataKey(k);
const data = (k: string) => isDataKey(k) && !isLayoutKey(k);
const neither = (k: string) => !isLayoutKey(k) && !isDataKey(k);

describe('what a scene keeps', () => {
  it('keeps the Inputs page filters, groups, sort and columns (and its side tab) as layout', () => {
    expect(layout('models.fileDetails')).toBe(true);
    expect(layout('inputs.sideTab')).toBe(true);
  });

  it('keeps colour, section cuts, property visibility and the Programmes layouts as layout', () => {
    for (const k of ['models.colour', 'viewer.sectionCuts', 'models.propertyVisibility', 'viewer.pageViews', 'app.sidePane', 'export.sound']) expect(layout(k)).toBe(true);
  });

  it('keeps the project folder and the programme choice with the scene, so each scene opens its own project', () => {
    for (const k of ['scenarios.root', 'programmes.choice']) expect(layout(k)).toBe(true);
  });

  it('owns viewpoints, topics, search sets, markers and construction planes as the scene\'s lists', () => {
    for (const k of ['viewer.viewpoints', 'models.topics', 'viewer.searchSets', 'viewer.markers', 'viewer.constructionPlanes']) expect(data(k)).toBe(true);
  });

  it('leaves the user\'s shared data and the scene list itself out', () => {
    for (const k of ['profiles.layout', 'sequence.linkGroups', 'sequence.tags', 'schedule.pourMap', 'timelines.data']) expect(neither(k)).toBe(true);
  });
});
