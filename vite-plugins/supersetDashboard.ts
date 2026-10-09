import { Superset, SupersetError } from './supersetApi';

/** The "Compare programmes" dashboard in Superset: the weekly concrete (m3) and rebar (t) of several programmes laid over each
    other, week by week from each one's first pour, with the running total. It reads the `skyline_weekly` dataset the stack's
    build_analysis.py makes from the programmes loaded in the app, the generated scenarios and the Project A extract, so a
    programme appears here after it is loaded and the data updated (Dashboards > Update data).

    Built over the API and safe to run again: charts and the dashboard are found by name and brought up to date. */

const DASHBOARD = 'Compare programmes';
const DATASET = 'skyline_weekly';

const sql = (expression: string, label: string) => ({ expressionType: 'SQL', sqlExpression: expression, label });
const kindFilter = (kind: string, id: string) => ({ expressionType: 'SIMPLE', subject: 'kind', operator: '==', comparator: kind, clause: 'WHERE', filterOptionName: id });

/** Weekly bars with the running total as a line on the second axis, one series per source. */
function mixed(datasource: string, kind: 'Concrete' | 'Rebar', unit: string) {
  const lower = kind.toLowerCase();
  return {
    viz_type: 'mixed_timeseries',
    datasource,
    time_range: 'No filter',
    row_limit: 10000,
    x_axis: 'week_no',
    time_grain_sqla: null,
    metrics: [sql('SUM(qty)', `Weekly ${lower} (${unit})`)],
    groupby: ['source'],
    adhoc_filters: [kindFilter(kind, `${lower}1`)],
    seriesType: 'bar',
    stack: false,
    metrics_b: [sql('SUM(qty)', `Cumulative ${lower} (${unit})`)],
    groupby_b: ['source'],
    adhoc_filters_b: [kindFilter(kind, `${lower}2`)],
    seriesTypeB: 'line',
    yAxisIndexB: 1,
    rolling_type_b: 'cumsum',
    rolling_type: 'None',
    show_legend: true,
    markerEnabled: false,
    opacity: 0.45,
    x_axis_title: 'Weeks since first pour',
    x_axis_title_margin: 30,
    y_axis_title: `Weekly ${lower} (${unit})`,
    y_axis_title_margin: 50,
    y_axis_title_b: `Cumulative ${lower} (${unit})`,
    y_axis_title_margin_b: 50,
    sort_series_type: 'name',
    sort_series_ascending: true,
  };
}

function summary(datasource: string) {
  return {
    viz_type: 'table',
    datasource,
    query_mode: 'aggregate',
    time_range: 'No filter',
    groupby: ['source', 'building', 'kind'],
    metrics: [sql('SUM(qty)', 'Total'), sql('MAX(week_no) + 1', 'Weeks'), sql('SUM(items)', 'Pours / items')],
    all_columns: [],
    percent_metrics: [],
    adhoc_filters: [],
    order_by_cols: [],
    row_limit: 1000,
    order_desc: false,
    page_length: 0,
    include_search: true,
    show_cell_bars: false,
    table_timestamp_format: 'smart_date',
    allow_render_html: false,
  };
}

const MARKDOWN = [
  '**Compare programmes** — concrete (m³) and rebar (t) by week since each programme\'s first pour, bars per week and a line for the running total.',
  '',
  '1. Load the programmes in Insight Plan (Inputs) and the HPC extract with `Load-Project-A.bat`.',
  '2. Dashboards › **Update data** in the app, then refresh this page.',
  '3. Pick the **Source**s to lay over each other (for example `Programme PAA Baseline…` against a `Scenario …`) and the **Building**.',
].join('\n');

export async function buildCompareDashboard(api: Superset) {
  const datasets = await api.call('GET', `/api/v1/dataset/${Superset.q('(page_size:200)')}`);
  const ds = (datasets.result ?? []).find((d: any) => d.table_name === DATASET);
  if (!ds) throw new SupersetError(`Superset has no "${DATASET}" dataset yet. Run Dashboards > Update data (build_analysis.py), then add it.`, 409);
  const datasource = `${ds.id}__table`;

  // The dashboard first (charts are attached to it), then the charts, then the layout that names them.
  const listed = await api.call('GET', `/api/v1/dashboard/${Superset.q(`(filters:!((col:dashboard_title,opr:eq,value:'${DASHBOARD}')))`)}`);
  let dashboardId: number = listed.result?.[0]?.id;
  if (!dashboardId) dashboardId = (await api.call('POST', '/api/v1/dashboard/', { dashboard_title: DASHBOARD, published: true })).id;

  const specs: { name: string; viz: string; params: object }[] = [
    { name: 'Compare: concrete (m3) by week, programmes over each other', viz: 'mixed_timeseries', params: mixed(datasource, 'Concrete', 'm3') },
    { name: 'Compare: rebar (t) by week, programmes over each other', viz: 'mixed_timeseries', params: mixed(datasource, 'Rebar', 't') },
    { name: 'Compare: totals by source, building and kind', viz: 'table', params: summary(datasource) },
  ];
  const ids: number[] = [];
  for (const s of specs) {
    const found = await api.call('GET', `/api/v1/chart/${Superset.q(`(filters:!((col:slice_name,opr:eq,value:'${s.name.replace(/'/g, "''")}')))`)}`);
    const body = { slice_name: s.name, viz_type: s.viz, datasource_id: ds.id, datasource_type: 'table', params: JSON.stringify(s.params), dashboards: [dashboardId] };
    const id: number = found.result?.[0]?.id;
    if (id) {
      await api.call('PUT', `/api/v1/chart/${id}`, body);
      ids.push(id);
    } else {
      ids.push((await api.call('POST', '/api/v1/chart/', body)).id);
    }
  }

  const row = (name: string, children: string[], height?: number) => ({ type: 'ROW', id: name, children, parents: ['ROOT_ID', 'GRID_ID'], meta: { background: 'BACKGROUND_TRANSPARENT' }, ...(height ? {} : {}) });
  const chart = (id: number, parent: string, height: number) => ({ type: 'CHART', id: `CHART-${id}`, children: [], parents: ['ROOT_ID', 'GRID_ID', parent], meta: { chartId: id, width: 12, height } });
  const layout: Record<string, unknown> = {
    DASHBOARD_VERSION_KEY: 'v2',
    ROOT_ID: { type: 'ROOT', id: 'ROOT_ID', children: ['GRID_ID'] },
    GRID_ID: { type: 'GRID', id: 'GRID_ID', children: ['ROW-help', 'ROW-0', 'ROW-1', 'ROW-2'], parents: ['ROOT_ID'] },
    'ROW-help': row('ROW-help', ['MARKDOWN-help']),
    'MARKDOWN-help': { type: 'MARKDOWN', id: 'MARKDOWN-help', children: [], parents: ['ROOT_ID', 'GRID_ID', 'ROW-help'], meta: { width: 12, height: 20, code: MARKDOWN } },
    'ROW-0': row('ROW-0', [`CHART-${ids[0]}`]),
    [`CHART-${ids[0]}`]: chart(ids[0], 'ROW-0', 72),
    'ROW-1': row('ROW-1', [`CHART-${ids[1]}`]),
    [`CHART-${ids[1]}`]: chart(ids[1], 'ROW-1', 72),
    'ROW-2': row('ROW-2', [`CHART-${ids[2]}`]),
    [`CHART-${ids[2]}`]: chart(ids[2], 'ROW-2', 50),
  };

  const filter = (column: string, name: string, multi: boolean) => ({
    id: `NATIVE_FILTER-compare-${column}`,
    name,
    filterType: 'filter_select',
    targets: [{ datasetId: ds.id, column: { name: column } }],
    controlValues: { multiSelect: multi, enableEmptyFilter: false, defaultToFirstItem: false, inverseSelection: false, searchAllOptions: false },
    defaultDataMask: { extraFormData: {}, filterState: {} },
    cascadeParentIds: [],
    scope: { rootPath: ['ROOT_ID'], excluded: [] },
    type: 'NATIVE_FILTER',
    description: '',
  });
  const metadata = {
    native_filter_configuration: [filter('source', 'Source', true), filter('building', 'Building', true)],
    filter_bar_orientation: 'HORIZONTAL',
    show_native_filters: true,
    cross_filters_enabled: false,
    color_scheme: '',
    refresh_frequency: 0,
    timed_refresh_immune_slices: [],
    expanded_slices: {},
    label_colors: {},
    shared_label_colors: [],
    map_label_colors: {},
    color_scheme_domain: [],
  };
  await api.call('PUT', `/api/v1/dashboard/${dashboardId}`, { dashboard_title: DASHBOARD, published: true, position_json: JSON.stringify(layout), json_metadata: JSON.stringify(metadata) });
  return { dashboardId, charts: ids, url: `/superset/dashboard/${dashboardId}/` };
}
