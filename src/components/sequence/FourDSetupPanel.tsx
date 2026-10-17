import { useMemo } from 'react';
import { computeGroupLinks, type LinkGroup } from '../../schedule/linkGroups';
import { useLinkGroupsStore } from '../../state/linkGroupsStore';
import { useModelsStore } from '../../state/modelsStore';
import { useSequenceSchedule } from '../../state/scheduleStore';
import { useViewerEngine } from '../../viewer/ViewerEngineContext';
import { CollapsibleSection, useOpenSections } from '../CollapsibleSection';
import { DockPanel } from '../Dock';
import { IconAddCircleOutline, IconDownload } from '../icons';
import { AppearancePanel, useAppearanceUiStore } from './AppearancePanel';
import { NeedsModels } from './NeedsModels';
import { useAppearanceStore } from '../../state/appearanceStore';
import { TagsSection } from './LabelPanel';
import { LinkGroupsPanel, exportLinkGroupMatches, useLinkGroupsUiStore } from './LinkGroupsPanel';

/** The 4D panel on the pages that are not 4D Sequencing (Models, Programmes): the Link Groups, which say which objects each activity
    stands for, and the Appearance Profiles, which say how they look as the work goes on. They are the same ones 4D uses; what plays the
    sequence (the date, the colours on the model) stays on the 4D page. It is what links activities to objects, so linking by picking
    objects works from the page you are planning on. */
export function FourDSetupPanel() {
  const engine = useViewerEngine();
  const model = useSequenceSchedule();
  const allModels = useModelsStore((s) => s.models);
  const hidden = useModelsStore((s) => s.hiddenModelIds);
  const models = useMemo(() => allModels.filter((m) => !hidden.has(m.modelId)), [allModels, hidden]);
  const allElements = useMemo(() => models.flatMap((m) => m.elements), [models]);
  const groups = useLinkGroupsStore((s) => s.groups);
  const profiles = useAppearanceStore((s) => s.profiles);
  const sections = useOpenSections<'groups' | 'appearance'>('sequence.4dSections2', ['groups', 'appearance']);

  /** Shows what a group matches: its objects in the group's colour, and the view goes to them. */
  const previewGroup = async (group: LinkGroup) => {
    if (!model || models.length === 0) return;
    const idsByModel = new Map<string, number[]>();
    for (const m of models) {
      const ids = [...computeGroupLinks(model, m.elements, group).elementIds];
      idsByModel.set(m.modelId, ids);
      await engine.setColor(m.modelId, ids, group.color);
    }
    await engine.fitToModelIds(idsByModel);
  };

  return (
    <DockPanel id="fourD" label="4D">
      <div className="config-panel__body model-config__body" style={{ flex: 1, minHeight: 0 }}>
        <div>
          {models.length === 0 && <NeedsModels compact />}
          {model ? (
            <CollapsibleSection
              title={`Link Groups (${groups.length})`}
              open={sections.isOpen('groups')}
              onToggle={() => sections.toggle('groups')}
              flush
              actions={
                <>
                  <button type="button" className="mini-btn mini-btn--icon" onClick={() => exportLinkGroupMatches(model, allElements, groups)} title="Export matches (CSV): the matched task/object pairs and which fields matched them" aria-label="Export matches (CSV)">
                    <IconDownload width={16} height={16} />
                  </button>
                  <button type="button" className="mini-btn mini-btn--icon" onClick={() => { if (!sections.isOpen('groups')) sections.toggle('groups'); useLinkGroupsUiStore.getState().requestNew(); }} title="New group" aria-label="New group">
                    <IconAddCircleOutline width={20} height={20} />
                  </button>
                </>
              }
            >
              <LinkGroupsPanel model={model} elements={allElements} elementSets={models.map((m) => m.elements)} onPreview={previewGroup} />
            </CollapsibleSection>
          ) : (
            <div style={{ padding: 12, color: 'var(--text-dim)' }}>Load a programme in Inputs to define Link Groups.</div>
          )}
          <CollapsibleSection
            title={`Appearance Profiles (${profiles.length})`}
            open={sections.isOpen('appearance')}
            onToggle={() => sections.toggle('appearance')}
            flush
            actions={
              <button type="button" className="mini-btn mini-btn--icon" onClick={() => { if (!sections.isOpen('appearance')) sections.toggle('appearance'); useAppearanceUiStore.getState().requestNew(); }} title="New profile" aria-label="New profile">
                <IconAddCircleOutline width={20} height={20} />
              </button>
            }
          >
            <AppearancePanel />
          </CollapsibleSection>
          <TagsSection />
        </div>
      </div>
    </DockPanel>
  );
}
