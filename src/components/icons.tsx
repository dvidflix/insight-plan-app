import type { SVGProps } from 'react';
import columnsSvg from '../icons/columns.svg?raw';
import windowTemplateSvg from '../icons/window-template.svg?raw';
import treeSvg from '../icons/tree-structure.svg?raw';
import sortSvg from '../icons/modus-icon-arrows-down-up.svg?raw';
import arrowUpSvg from '../icons/modus-icon-arrow-up.svg?raw';
import arrowDownSvg from '../icons/modus-icon-arrow-down.svg?raw';
import arrowLineUpSvg from '../icons/modus-icon-arrow-line-up.svg?raw';
import arrowLineDownSvg from '../icons/modus-icon-arrow-line-down.svg?raw';
import arrowLineLeftSvg from '../icons/modus-icon-arrow-line-left.svg?raw';
import navigationArrowSvg from '../icons/modus-icon-navigation-arrow.svg?raw';
import walkSvg from '../icons/walk.svg?raw';
import shortTextSvg from '../icons/short-text.svg?raw';
import tagOutlineSvg from '../icons/modus-icon-tag.svg?raw';
import modelGeometrySvg from '../icons/model-geometry-outline.svg?raw';
import cameraSvg from '../icons/camera.svg?raw';
import filterSvg from '../icons/filter.svg?raw';
import pencilSvg from '../icons/pencil.svg?raw';
import chevronLeftSvg from '../icons/chevron-left.svg?raw';
import chevronRightSvg from '../icons/chevron-right.svg?raw';
import firstPageSvg from '../icons/first-page.svg?raw';
import lastPageSvg from '../icons/last-page.svg?raw';
import rewindSvg from '../icons/rewind.svg?raw';
import playCircleSvg from '../icons/play-circle.svg?raw';
import pauseCircleSvg from '../icons/pause-circle.svg?raw';
import stopCircleSvg from '../icons/stop-circle.svg?raw';
import infoSvg from '../icons/info.svg?raw';
import sidePanelSvg from '../icons/window-side-panel.svg?raw';
import linkSvg from '../icons/link.svg?raw';
import twoPaneSvg from '../icons/two-pane.svg?raw';
import singlePaneSvg from '../icons/single-pane.svg?raw';
import launchSvg from '../icons/launch.svg?raw';
import searchSvg from '../icons/search.svg?raw';
import deleteSvg from '../icons/delete.svg?raw';
import updateSvg from '../icons/update.svg?raw';
import locationPointSvg from '../icons/location-point.svg?raw';
import boxSelectSvg from '../icons/box-select.svg?raw';
import textInputShortSvg from '../icons/text-input-short.svg?raw';
import viewTableSvg from '../icons/view-table.svg?raw';
import fullscreenSvg from '../icons/fullscreen.svg?raw';
import selectSingleSvg from '../icons/select-single.svg?raw';
import selectAreaSvg from '../icons/select-area.svg?raw';
import selectSubtractSvg from '../icons/select-objects-subtract.svg?raw';
import zoomToSelectedSvg from '../icons/zoom-to-selected-item.svg?raw';
import tbViewShowAllSvg from '../icons/view-show-all.svg?raw';
import tbGridSvg from '../icons/grid.svg?raw';
import tbModelOrthoSvg from '../icons/model-ortho.svg?raw';
import tbViewAxonSvg from '../icons/model-view-default.svg?raw';
import tbViewTopSvg from '../icons/model-view-top.svg?raw';
import tbViewFrontSvg from '../icons/model-view-front.svg?raw';
import tbViewLeftSvg from '../icons/model-view-left.svg?raw';
import tbViewBackSvg from '../icons/model-view-back.svg?raw';
import tbViewRightSvg from '../icons/model-view-right.svg?raw';
import tbViewBottomSvg from '../icons/model-view-bottom.svg?raw';
import tbDeleteAllSvg from '../icons/delete-all.svg?raw';
import cubeSvg from '../icons/modus-icon-cube.svg?raw';
import checkboxCheckedSvg from '../icons/checkbox-checked.svg?raw';
import checkboxUncheckedSvg from '../icons/checkbox-unchecked.svg?raw';
import downloadFileSvg from '../icons/download.svg?raw';
import expandMoreSvg from '../icons/expand-more.svg?raw';
import rerouteSvg from '../icons/reroute.svg?raw';
import driverSvg from '../icons/driver.svg?raw';
import bookingsOpenSvg from '../icons/bookings-open.svg?raw';
import dashboardSvg from '../icons/dashboard.svg?raw';
import modusTableSvg from '../icons/modus-icon-table.svg?raw';
import cubeFocusSvg from '../icons/modus-icon-cube-focus.svg?raw';
import visibilityPartSvg from '../icons/visibility-part-outline.svg?raw';
import videoCameraSvg from '../icons/modus-icon-video-camera.svg?raw';
import videoCameraSlashSvg from '../icons/modus-icon-video-camera-slash.svg?raw';
import actionUndoSvg from '../icons/action-undo.svg?raw';
import infoOutlinedSvg from '../icons/info-outlined.svg?raw';
import timelineSvg from '../icons/modus-icon-tag-chevron.svg?raw';
import flagSvg from '../icons/flag.svg?raw';
import flagFinishSvg from '../icons/flag-finish.svg?raw';
import collapseSvg from '../icons/collapse.svg?raw';
import expand1Svg from '../icons/expand-1.svg?raw';
import actionRedoSvg from '../icons/action-redo.svg?raw';
import tbMeasureLengthSvg from '../icons/measure-length.svg?raw';
import tbMeasureAreaSvg from '../icons/measure-area.svg?raw';
import tbMeasurePerimeterSvg from '../icons/measure-perimeter.svg?raw';
import tbMeasureSlopeSvg from '../icons/measure-slope.svg?raw';
import tbMeasureVerticalSvg from '../icons/measure-vertical.svg?raw';
import tbZoomCenterSvg from '../icons/zoom-center.svg?raw';
import tbVisibilitySvg from '../icons/eye-visibility.svg?raw';
import tbVisibilityOffSvg from '../icons/visibility-off.svg?raw';
import tbGhostSvg from '../icons/ghost.svg?raw';
import copySvg from '../icons/copy.svg?raw';
import tbTransparencySvg from '../icons/transparency.svg?raw';

/** A small curated set of icons, ported from insight-plan-web's inline SVG
    sprite (generic Material Symbols glyphs, not a proprietary Trimble asset)
    plus a couple of extras (sun/moon) that app didn't need. All render at
    `currentColor` so they follow the surrounding text/icon-button color. */
function Icon({ path, ...props }: { path: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" {...props}>
      <path d={path} />
    </svg>
  );
}

/** An icon drawn from one of the SVG files in src/icons, as the file has it
    (its own viewBox and paths; they use `currentColor`, so the icon follows
    the surrounding text / button colour like the others). */
function svgIcon(raw: string) {
  const viewBox = /<svg[^>]*\sviewBox="([^"]+)"/.exec(raw)?.[1] ?? '0 0 24 24';
  const fill = /<svg[^>]*\sfill="([^"]+)"/.exec(raw)?.[1] ?? 'none';
  const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return (p: SVGProps<SVGSVGElement>) => <svg viewBox={viewBox} width="16" height="16" fill={fill} {...p} dangerouslySetInnerHTML={{ __html: inner }} />;
}

export const IconFilter = svgIcon(filterSvg);
/** Move up / down one step, and to the first / last step. */
export const IconArrowUp = svgIcon(arrowUpSvg);
export const IconArrowDown = svgIcon(arrowDownSvg);
export const IconArrowLineUp = svgIcon(arrowLineUpSvg);
export const IconArrowLineDown = svgIcon(arrowLineDownSvg);
/** North arrow (viewer overlay). */
export const IconNavigationArrow = svgIcon(navigationArrowSvg);
/** Walkthrough: move through the model with the keyboard. */
export const IconWalk = svgIcon(walkSvg);
/** Text lines (date label). */
export const IconShortText = svgIcon(shortTextSvg);
/** Tag, outline (menus, next to the other outline icons). */
export const IconTagOutline = svgIcon(tagOutlineSvg);
/** View cube (viewer overlay). */
export const IconViewCube = svgIcon(modelGeometrySvg);

/** IFC grids: axis lines with a bubble at the end. */
export const IconIfcGrid = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
    <path d="M8 9v13M16 9v13M2 15h20M2 20h20" strokeDasharray="3 2" />
    <circle cx="8" cy="5" r="3" />
    <circle cx="16" cy="5" r="3" />
  </svg>
);

/** Paint bucket, with a bar in `bar` (the colour that will be applied). */
export const IconPaintBucket = ({ bar, ...p }: SVGProps<SVGSVGElement> & { bar?: string }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" {...p}>
    <path d="M16.56 8.94 7.62 0 6.21 1.41l2.38 2.38-5.15 5.15a1.49 1.49 0 0 0 0 2.12l5.5 5.5c.29.29.68.44 1.06.44s.77-.15 1.06-.44l5.5-5.5c.59-.58.59-1.53 0-2.12zM5.21 10 10 5.21 14.79 10H5.21zM19 11.5s-2 2.17-2 3.5c0 1.1.9 2 2 2s2-.9 2-2c0-1.33-2-3.5-2-3.5z" />
    {bar && <rect x="2" y="20" width="20" height="3.5" rx="1" fill={bar} stroke="rgba(0,0,0,0.25)" strokeWidth="0.6" />}
  </svg>
);

export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" {...p}>
    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z" />
  </svg>
);
export const IconPencil = svgIcon(pencilSvg);

// ---- 4D timeline transport, info, side panel (src/icons) ----
export const IconFirstPage = svgIcon(firstPageSvg);
export const IconLastPage = svgIcon(lastPageSvg);
export const IconRewind = svgIcon(rewindSvg);
export const IconPlayCircle = svgIcon(playCircleSvg);
export const IconPauseCircle = svgIcon(pauseCircleSvg);
export const IconStopCircle = svgIcon(stopCircleSvg);
export const IconInfo = svgIcon(infoSvg);
export const IconSidePanel = svgIcon(sidePanelSvg);
export const IconRelated = svgIcon(linkSvg);
export const IconTwoPane = svgIcon(twoPaneSvg);
export const IconSinglePane = svgIcon(singlePaneSvg);
export const IconLaunch = svgIcon(launchSvg);
export const IconSearch = svgIcon(searchSvg);
export const IconTrash = svgIcon(deleteSvg);
export const IconSync = svgIcon(updateSvg);
export const IconLocationPoint = svgIcon(locationPointSvg);
export const IconSelectionSet = svgIcon(boxSelectSvg);
export const IconTextInputShort = svgIcon(textInputShortSvg);
export const IconViewTable = svgIcon(viewTableSvg);
export const IconFullscreen = svgIcon(fullscreenSvg);


export const IconSort = svgIcon(sortSvg);

export const IconGroup = (p: SVGProps<SVGSVGElement>) => (
  <Icon
    {...p}
    path="M12.024 13.585c.44 0 .793.354.793.793v2.759c0 .437.356.793.793.793h1.258l-.232-.233a.793.793 0 0 1 1.12-1.122l1.587 1.586q.11.11.172.26a.8.8 0 0 1-.172.863l-1.586 1.585a.792.792 0 1 1-1.121-1.121l.232-.232H13.61a2.38 2.38 0 0 1-2.379-2.38v-2.758c0-.439.355-.793.793-.793m9.897 5.758h-2.48v-2h2.48zM3.793 6.241c.438 0 .793.354.793.793v2.76c0 .436.356.792.793.792h1.258l-.232-.232a.792.792 0 1 1 1.121-1.121l1.585 1.585q.112.11.173.258a.79.79 0 0 1-.173.865l-1.585 1.586a.792.792 0 1 1-1.12-1.122l.23-.233H5.38A2.38 2.38 0 0 1 3 9.793V7.034c0-.439.355-.793.793-.793m18.129 5.931H11.163v-2h10.759zm0-7.173H3V3h18.922z"
  />
);

export const IconTable = (p: SVGProps<SVGSVGElement>) => (
  <Icon
    {...p}
    path="M4 2h16c1.1 0 2 .9 2 2v16c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2m0 18h4v-4H4zm4-6H4v-4h4zM4 8h4V4H4zm10 12h-4v-4h4zm-4-6h4v-4h-4zm4-6h-4V4h4zm2 12h4v-4h-4zm4-6h-4v-4h4zm-4-6h4V4h-4z"
  />
);

export const IconGantt = (p: SVGProps<SVGSVGElement>) => (
  <Icon
    {...p}
    path="M22 21.25c0 .41-.34.75-.75.75H2V2.75c0-.41.34-.75.75-.75s.75.34.75.75V20.5h17.75c.41 0 .75.34.75.75M13 8.5v-1c0-.28-.22-.5-.5-.5h-7c-.28 0-.5.22-.5.5v1c0 .28.22.5.5.5h7c.28 0 .5-.22.5-.5m5 4v-1c0-.28-.22-.5-.5-.5h-7c-.28 0-.5.22-.5.5v1c0 .28.22.5.5.5h7c.28 0 .5-.22.5-.5m4 4v-1c0-.28-.22-.5-.5-.5h-5c-.28 0-.5.22-.5.5v1c0 .28.22.5.5.5h5c.28 0 .5-.22.5-.5"
  />
);

export const IconCalendar = (p: SVGProps<SVGSVGElement>) => (
  <Icon
    {...p}
    path="M20 3h-2c0-.55-.45-1-1-1s-1 .45-1 1H8c0-.55-.45-1-1-1s-1 .45-1 1H4c-1.1 0-2 .9-2 2v15c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2M9 19H6v-3h3zm0-5H6v-3h3zm4.5 5h-3v-3h3zm0-5h-3v-3h3zm4.5 5h-3v-3h3zm0-5h-3v-3h3zm2-6.71c0 .39-.32.71-.71.71H4.71C4.32 8 4 7.68 4 7.29V5.7c0-.39.32-.71.71-.71H6V6c0 .55.45 1 1 1s1-.45 1-1V5l8-.01V6c0 .55.45 1 1 1s1-.45 1-1V5l1.29-.01c.39 0 .71.32.71.71z"
  />
);

export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <Icon
    {...p}
    path="M19 13v6H5v-6c0-.55-.45-1-1-1s-1 .45-1 1v7c0 .55.45 1 1 1h16c.55 0 1-.45 1-1v-7c0-.55-.45-1-1-1s-1 .45-1 1m-6-.33 1.88-1.88a.996.996 0 1 1 1.41 1.41l-3.59 3.59a.996.996 0 0 1-1.41 0L7.7 12.2a.996.996 0 1 1 1.41-1.41l1.88 1.88V4c0-.55.45-1 1-1s1 .45 1 1v8.67Z"
  />
);

export const IconUpload = (p: SVGProps<SVGSVGElement>) => (
  <Icon
    {...p}
    path="M5 19h14v-2H5zm0-9h4v6h6v-6h4l-7-7z"
  />
);

export const IconGear = (p: SVGProps<SVGSVGElement>) => (
  <Icon
    {...p}
    path="M14.002 2c.25 0 .46.18.49.42l.38 2.65c.61.25 1.17.58 1.69.98l2.49-1c.22-.08.49 0 .61.22l2 3.46c.12.22.07.49-.12.64l-2.11 1.65c.04.32.07.64.07.98s-.03.66-.07.98l2.11 1.65c.19.15.24.42.12.64l-2 3.46c-.12.22-.38.31-.61.22l-2.49-1c-.52.39-1.08.73-1.69.98l-.38 2.65c-.03.24-.24.42-.49.42h-4c-.25 0-.46-.18-.49-.42l-.38-2.65c-.61-.25-1.17-.58-1.69-.98l-2.49 1c-.22.08-.49 0-.61-.22l-2-3.46a.504.504 0 0 1 .12-.64l2.11-1.65c-.04-.32-.07-.65-.07-.98s.03-.66.07-.98l-2.11-1.65a.493.493 0 0 1-.12-.64l2-3.46c.12-.22.38-.31.61-.22l2.49 1c.52-.39 1.08-.73 1.69-.98l.38-2.65c.03-.24.24-.42.49-.42zm-2 6.5c-1.93 0-3.5 1.57-3.5 3.5s1.57 3.5 3.5 3.5 3.5-1.57 3.5-3.5-1.57-3.5-3.5-3.5"
  />
);

export const IconFolder = (p: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 256 256"
    width={p.width ?? 16}
    height={p.height ?? 16}
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="16"
    {...p}
  >
    <path d="M216.89 208H39.38a7.4 7.4 0 0 1-7.38-7.38V80h184a8 8 0 0 1 8 8v112.89a7.11 7.11 0 0 1-7.11 7.11M32 80V56a8 8 0 0 1 8-8h52.69a8 8 0 0 1 5.65 2.34L128 80" />
  </svg>
);

export const IconWarning = (p: SVGProps<SVGSVGElement>) => (
  <Icon
    {...p}
    path="M11.246 2.435a.87.87 0 0 1 1.507 0l10.129 17.493a.872.872 0 0 1-.755 1.307H1.872a.872.872 0 0 1-.754-1.307zM12 15.945a1.058 1.058 0 1 0 .002 2.117A1.058 1.058 0 0 0 12 15.945m-.894-6.348a.165.165 0 0 0-.164.164v3.904c0 .091.074.164.164.164h1.79c.09 0 .163-.073.163-.164V9.761a.164.164 0 0 0-.163-.164z"
  />
);

export const IconClose = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} path="M18.364 7.05 13.414 12l4.95 4.95-1.415 1.413L12 13.414l-4.95 4.95-1.414-1.415L10.586 12l-4.95-4.95L7.05 5.636l4.95 4.95 4.95-4.95z" />
);

export const IconEye = (p: SVGProps<SVGSVGElement>) => (
  <Icon
    {...p}
    path="M12 4.5c5 0 9.27 3.11 11 7.5-1.73 4.39-6 7.5-11 7.5S2.73 16.39 1 12c1.73-4.39 6-7.5 11-7.5m0 12.5c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5m0-8c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3"
  />
);

export const IconEyeOff = (p: SVGProps<SVGSVGElement>) => (
  <Icon
    {...p}
    path="m21.005 20.23-1.27 1.27-2.93-2.92-.42-.42c-1.35.54-2.83.84-4.38.84-5 0-9.27-3.11-11-7.5.78-1.98 2.08-3.7 3.74-4.99l-2.74-2.74 1.27-1.27zM7.535 9.3c-.33.67-.53 1.41-.53 2.2 0 2.76 2.24 5 5 5 .79 0 1.53-.2 2.2-.53l-1.55-1.55c-.21.05-.43.08-.65.08-1.66 0-3-1.34-3-3 0-.22.03-.44.08-.65zm4.46-5.3c5 0 9.27 3.11 11 7.5-.73 1.86-1.92 3.49-3.43 4.75l-2.92-2.92c.23-.57.36-1.18.36-1.83 0-2.76-2.24-5-5-5-.65 0-1.26.13-1.83.36L8.015 4.7c1.24-.45 2.58-.7 3.98-.7m.02 4.51c1.66 0 3 1.34 3 3l-.02.16-3.15-3.15z"
  />
);

export const IconBackground = (p: SVGProps<SVGSVGElement>) => (
  <Icon
    {...p}
    path="M24 24H0v-3.84h24zM16.56 8.94c.59.59.59 1.54 0 2.12l-5.5 5.5c-.29.29-.68.44-1.06.44s-.77-.15-1.06-.44l-5.5-5.5a1.49 1.49 0 0 1 0-2.12l5.15-5.15-2.38-2.38L7.62 0zM19 11.5c.001.001 2 2.17 2 3.5 0 1.1-.9 2-2 2s-2-.9-2-2c0-1.33 2-3.5 2-3.5M5.21 10h9.58L10 5.21z"
  />
);

export const IconToggleOff = (p: SVGProps<SVGSVGElement>) => (
  <Icon
    {...p}
    path="M17.5 7c3.036 0 5.5 2.464 5.5 5.5S20.536 18 17.5 18h-11A5.5 5.5 0 0 1 1 12.5C1 9.464 3.464 7 6.5 7zm-11 1.1a4.395 4.395 0 0 0-4.4 4.4c0 2.435 1.965 4.4 4.4 4.4s4.4-1.965 4.4-4.4-1.965-4.4-4.4-4.4"
  />
);

export const IconSchema = (p: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    width={p.width ?? 16}
    height={p.height ?? 16}
    fill="currentColor"
    {...p}
  >
    <path d="M11.99 2C17.52 2 22 6.48 22 12s-4.48 10-10.01 10C6.47 22 2 17.52 2 12S6.47 2 11.99 2M12 4c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8m.5 3v5.25l4.5 2.67-.75 1.23L11 13V7z" />
  </svg>
);

export const IconLineGraph = (p: SVGProps<SVGSVGElement>) => (
  <Icon
    {...p}
    path="M20 5a.753.753 0 0 0-.95.47l-1.18 3.54c-.97.06-1.75.81-1.85 1.77l-3.45.99C12.2 11.3 11.64 11 11 11c-1.1 0-2 .9-2 2q0 .39.15.75l-4.15 4V5c0-.55-.45-1-1-1s-1 .45-1 1v16h16c.55 0 1-.45 1-1s-.45-1-1-1H5.87l4.32-4.18c.25.11.52.18.81.18 1.03 0 1.87-.78 1.98-1.79l3.45-.99c.37.47.93.77 1.57.77 1.1 0 2-.9 2-2 0-.61-.28-1.15-.71-1.51l1.18-3.54a.753.753 0 0 0-.47-.95Zm-8.19 8.55c-.17.25-.44.42-.76.44-.02 0-.04.01-.05.01-.55 0-1-.45-1-1 0-.03.02-.06.02-.1.05-.5.46-.9.98-.9.15 0 .29.04.42.1.34.16.58.5.58.9 0 .21-.08.39-.19.55M18 12c-.15 0-.29-.04-.42-.1A1 1 0 0 1 17 11c0-.21.08-.39.19-.55.08-.12.18-.22.3-.29.15-.09.32-.16.51-.16a1 1 0 0 1 1 1c0 .55-.45 1-1 1"
  />
);

export const IconBookmark = (p: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 256 256"
    width={p.width ?? 20}
    height={p.height ?? 20}
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="16"
    {...p}
  >
    <path d="m192 224-64-40-64 40V48a8 8 0 0 1 8-8h112a8 8 0 0 1 8 8Z" />
  </svg>
);

/** An open book (Wiki). */
export const IconBook = (p: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 256 256"
    width={p.width ?? 20}
    height={p.height ?? 20}
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="16"
    {...p}
  >
    <path d="M128 88a32 32 0 0 1 32-32h72v144h-72a32 32 0 0 0-32 32" />
    <path d="M24 200h72a32 32 0 0 1 32 32V88a32 32 0 0 0-32-32H24Z" />
  </svg>
);

export const IconChevronRight = svgIcon(chevronRightSvg);

export const IconChevronDown = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} path="M16.59 8.295 12 12.875l-4.59-4.58L6 9.705l6 6 6-6z" />
);

export const IconDragVert = (p: SVGProps<SVGSVGElement>) => (
  <Icon
    {...p}
    path="M9 8c1.101 0 2-.9 2-2s-.899-2-2-2-2 .9-2 2 .9 2 2 2m0 6c1.101 0 2-.9 2-2s-.899-2-2-2-2 .9-2 2 .9 2 2 2m0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.899-2-2-2m6 4c1.101 0 2-.9 2-2s-.899-2-2-2-2 .9-2 2 .9 2 2 2m0-6c1.101 0 2-.9 2-2s-.899-2-2-2-2 .9-2 2 .9 2 2 2m-2-8c0-1.1.9-2 2-2s2 .9 2 2-.899 2-2 2-2-.9-2-2"
  />
);

export const IconCube = (p: SVGProps<SVGSVGElement>) => (
  <Icon
    {...p}
    path="M17.886 4.343V10.4L23 12.43v8.142l-5.886 2.343L12 20.886l-5.114 2L1 20.543v-8.114l5.114-2V4.343L12 2zM2.028 19.457l4.03 1.743V16l-4.03-1.743zm5.115-3.485V21.2l4.314-1.857v-5.229zm5.4 3.37 4.314 1.858V16l-4.314-1.886zm5.4-3.37v5.2l4.029-1.743v-5.2zM2.856 13.2l-.286.115 4.03 1.743 4.057-1.743-3.886-1.658zm10.514.115 4.03 1.743 4-1.743-.258-.115-3.886-1.543zm-.828-6v5.2L16.6 10.77v-5.2zM7.4 10.77l4.057 1.714V7.286L7.4 5.543zm.743-6.057L12 6.37l3.857-1.685L12 3.172z"
  />
);

export const IconSun = (p: SVGProps<SVGSVGElement>) => (
  <Icon
    {...p}
    path="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10m0-14.5a1 1 0 0 1 1 1V5a1 1 0 1 1-2 0V3.5a1 1 0 0 1 1-1m0 17a1 1 0 0 1 1 1V22a1 1 0 1 1-2 0v-1.5a1 1 0 0 1 1-1M4.222 4.222a1 1 0 0 1 1.414 0l1.06 1.06a1 1 0 0 1-1.414 1.415l-1.06-1.06a1 1 0 0 1 0-1.415m14.142 14.142a1 1 0 0 1 1.415 0l1.06 1.06a1 1 0 0 1-1.414 1.415l-1.06-1.06a1 1 0 0 1 0-1.415M2.5 12a1 1 0 0 1 1-1H5a1 1 0 1 1 0 2H3.5a1 1 0 0 1-1-1m17 0a1 1 0 0 1 1-1H22a1 1 0 1 1 0 2h-1.5a1 1 0 0 1-1-1M4.222 19.778a1 1 0 0 1 0-1.415l1.06-1.06a1 1 0 1 1 1.415 1.414l-1.06 1.06a1 1 0 0 1-1.415 0m14.142-14.142a1 1 0 0 1 0-1.415l1.06-1.06a1 1 0 1 1 1.415 1.414l-1.06 1.06a1 1 0 0 1-1.415 0"
  />
);

export const IconMoon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} path="M21.5 14.5A9 9 0 1 1 9.5 2.5a7 7 0 0 0 12 12" />
);

export const IconSplit = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} path="M14 4l2.29 2.29-2.88 2.88 1.42 1.42 2.88-2.88L20 10V4zm-4 0H4v6l2.29-2.29 4.71 4.7V20h2v-8.41l-5.29-5.3z" />
);

// ---- Side pane tabs (Material Symbols glyphs) ----

export const IconChevronLeft = svgIcon(chevronLeftSvg);
export const IconArrowLineLeft = svgIcon(arrowLineLeftSvg);

export const IconTree = svgIcon(treeSvg);

export const IconList = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} path="M3 13h2v-2H3zm0 4h2v-2H3zm0-8h2V7H3zm4 4h14v-2H7zm0 4h14v-2H7zM7 7v2h14V7z" />
);

/** A checklist: ticks beside lines (Model checks). */
export const IconChecklist = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} path="M22 7h-9v2h9zm0 8h-9v2h9zM5.54 11 2 7.46l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41zm0 8L2 15.46l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41z" />
);

export const IconCategory = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} path="m12 2-5.5 9h11zm5.5 11a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9M3 21.5h8v-8H3z" />
);

export const IconCamera = svgIcon(cameraSvg);

export const IconTune = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} path="M3 17v2h6v-2zM3 5v2h10V5zm10 16v-2h8v-2h-8v-2h-2v6zM7 9v2H3v2h4v2h2V9zm14 4v-2H11v2zm-6-4h2V7h4V5h-4V3h-2z" />
);

export const IconChat = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} path="M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1m-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1" />
);

export const IconLink = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} path="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1M8 13h8v-2H8zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5" />
);

export const IconPalette = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} path="M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10a2.5 2.5 0 0 0 2.5-2.5c0-.61-.23-1.2-.64-1.67a.53.53 0 0 1-.13-.33c0-.28.22-.5.5-.5H16c3.31 0 6-2.69 6-6 0-4.96-4.49-9-10-9m5.5 11c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5m-3-4c-.83 0-1.5-.67-1.5-1.5S13.67 6 14.5 6s1.5.67 1.5 1.5S15.33 9 14.5 9M5 11.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5S7.33 13 6.5 13 5 12.33 5 11.5m6-4c0 .83-.67 1.5-1.5 1.5S8 8.33 8 7.5 8.67 6 9.5 6s1.5.67 1.5 1.5" />
);

export const IconTag = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} path="m21.41 11.58-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58s1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41s-.23-1.06-.59-1.42M5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7" />
);

export const IconColumns = svgIcon(columnsSvg);
export const IconScenes = svgIcon(windowTemplateSvg);

/** Section expand chevron (That Open's panel-section glyph): points up when
    open; `.section-chevron` turns it down while collapsed. */
export const IconSectionChevron = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} path="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z" />
);

export const IconVideoCam = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} path="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11z" />
);

// Viewer toolbar (components/ViewerToolbar.tsx).
export const IconViewShowAll = svgIcon(tbViewShowAllSvg);
export const IconGrid = svgIcon(tbGridSvg);
export const IconModelOrtho = svgIcon(tbModelOrthoSvg);
export const IconViewAxon = svgIcon(tbViewAxonSvg);
export const IconViewTop = svgIcon(tbViewTopSvg);
export const IconViewFront = svgIcon(tbViewFrontSvg);
export const IconViewLeft = svgIcon(tbViewLeftSvg);
export const IconViewBack = svgIcon(tbViewBackSvg);
export const IconViewRight = svgIcon(tbViewRightSvg);
export const IconViewBottom = svgIcon(tbViewBottomSvg);
export const IconDeleteAll = svgIcon(tbDeleteAllSvg);
export const IconPerspective = svgIcon(cubeSvg);
export const IconCheckboxChecked = svgIcon(checkboxCheckedSvg);
export const IconCheckboxUnchecked = svgIcon(checkboxUncheckedSvg);
export const IconDownloadFile = svgIcon(downloadFileSvg);
export const IconExpandMore = svgIcon(expandMoreSvg);

/** The expander for any group that opens and closes: a chevron pointing down
    when open, right when closed. */
export function IconExpander({ open, ...p }: { open: boolean } & SVGProps<SVGSVGElement>) {
  const Glyph = open ? IconExpandMore : IconChevronRight;
  return <Glyph className="expand-icon" aria-hidden="true" {...p} />;
}
export const IconReroute = svgIcon(rerouteSvg);
export const IconDriver = svgIcon(driverSvg);
export const IconBookingsOpen = svgIcon(bookingsOpenSvg);
export const IconCubeFocus = svgIcon(cubeFocusSvg);
export const IconVisibilityPart = svgIcon(visibilityPartSvg);
export const IconVideoCamera = svgIcon(videoCameraSvg);
export const IconVideoCameraSlash = svgIcon(videoCameraSlashSvg);
export const IconUndo = svgIcon(actionUndoSvg);
export const IconInfoOutlined = svgIcon(infoOutlinedSvg);
export const IconTimeline = svgIcon(timelineSvg);
export const IconFlag = svgIcon(flagSvg);
export const IconFlagFinish = svgIcon(flagFinishSvg);
export const IconCollapse = svgIcon(collapseSvg);
export const IconExpand = svgIcon(expand1Svg);
export const IconRedo = svgIcon(actionRedoSvg);
export const IconMeasureLength = svgIcon(tbMeasureLengthSvg);
export const IconMeasureArea = svgIcon(tbMeasureAreaSvg);
export const IconMeasurePerimeter = svgIcon(tbMeasurePerimeterSvg);
export const IconMeasureSlope = svgIcon(tbMeasureSlopeSvg);
export const IconMeasureVertical = svgIcon(tbMeasureVerticalSvg);
export const IconZoomCenter = svgIcon(tbZoomCenterSvg);
export const IconVisibility = svgIcon(tbVisibilitySvg);
export const IconVisibilityOff = svgIcon(tbVisibilityOffSvg);
export const IconGhost = svgIcon(tbGhostSvg);
export const IconTransparency = svgIcon(tbTransparencySvg);
export const IconSection = (p: SVGProps<SVGSVGElement>) => <Icon {...p} path="M19 3 13 9l2 2 7-7V3M12 12.5a.5.5 0 0 1-.5-.5.5.5 0 0 1 .5-.5.5.5 0 0 1 .5.5.5.5 0 0 1-.5.5M6 20a2 2 0 0 1-2-2c0-1.11.89-2 2-2a2 2 0 0 1 2 2 2 2 0 0 1-2 2M6 8a2 2 0 0 1-2-2c0-1.11.89-2 2-2a2 2 0 0 1 2 2 2 2 0 0 1-2 2m3.64-.36c.23-.5.36-1.05.36-1.64a4 4 0 0 0-4-4 4 4 0 0 0-4 4 4 4 0 0 0 4 4c.59 0 1.14-.13 1.64-.36L10 12l-2.36 2.36C7.14 14.13 6.59 14 6 14a4 4 0 0 0-4 4 4 4 0 0 0 4 4 4 4 0 0 0 4-4c0-.59-.13-1.14-.36-1.64L12 14l7 7h3v-1z" />;
export const IconCopy = svgIcon(copySvg);
export const IconPin = (p: SVGProps<SVGSVGElement>) => <Icon {...p} path="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2z" />;
export const IconCursor = svgIcon(selectSingleSvg);
export const IconBoxSelect = svgIcon(selectAreaSvg);
export const IconSelectOff = svgIcon(selectSubtractSvg);
export const IconZoomToSelected = svgIcon(zoomToSelectedSvg);
export const IconDashboard = svgIcon(dashboardSvg);
export const IconExternalData = svgIcon(modusTableSvg);
