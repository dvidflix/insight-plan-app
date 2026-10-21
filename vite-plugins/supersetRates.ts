import { Superset, SupersetError } from './supersetApi';

/** The "Rates by concrete volume" dashboard in Superset: how long decking, formwork, embeds under the slab and on top, curing and rebar take
    for the concrete volume of the pour they belong to. It reads the `pour_task_volume` dataset the stack's build_analysis.py makes (pour_link.py
    links every activity to its pour and carries that pour's concrete m3), from Project A and the generated scenarios.

    Built over the API and safe to run again: the dataset is added when it is missing, charts and the dashboard are found by name and updated. */

const DASHBOARD = 'Rates by concrete volume';
const DATASET = 'pour_task_volume';
const KINDS = ['Decking', 'Formwork', 'Embeds under slab', 'Embeds on top', 'Embeds', 'Curing', 'Rebar'];

const sql = (expression: string, label: string) => ({ expressionType: 'SQL', sqlExpression: expression, label });
const simple = (subject: string, operator: string, comparator: unknown, id: string) => ({ expressionType: 'SIMPLE', subject, operator, comparator, clause: 'WHERE', filterOptionName: id });
const filters = () => [simple('task_kind', 'IN', KINDS, 'kinds'), simple('reliable_link', '==', 1, 'reliable')];

/** Bars by task kind, one series per source. */
function barByKind(datasource: string, metrics: ReturnType<typeof sql>[], yTitle: string) {
  return {
    viz_type: 'echarts_timeseries_bar',
    datasource,
    time_range: 'No filter',
    row_limit: 10000,
    x_axis: 'task_kind',
    xAxisForceCategorical: true,
    x_axis_sort: 'Task kind',
    x_axis_sort_asc: true,
    time_grain_sqla: null,
    metrics,
    groupby: ['source'],
    adhoc_filters: filters(),
    orientation: 'vertical',
    show_legend: true,
    show_value: false,
    stack: false,
    x_axis_title: 'Task kind',
    x_axis_title_margin: 30,
    y_axis_title: yTitle,
    y_axis_title_margin: 50,
    sort_series_type: 'name',
    sort_series_ascending: true,
  };
}

/** How long each kind of task takes against the concrete volume of its pour (bands of 25 m3). */
function byVolumeBand(datasource: string) {
  return {
    viz_type: 'echarts_timeseries_line',
    datasource,
    time_range: 'No filter',
    row_limit: 10000,
    x_axis: sql('CAST(pour_concrete_m3 / 25 AS INTEGER) * 25', 'Pour concrete (m3, bands of 25)'),
    xAxisForceCategorical: true,
    time_grain_sqla: null,
    metrics: [sql('AVG(COALESCE(actual_cal_days, planned_dur_d))', 'Days (actual, else planned)')],
    groupby: ['task_kind'],
    adhoc_filters: filters(),
    show_legend: true,
    markerEnabled: true,
    markerSize: 6,
    x_axis_title: 'Concrete volume of the pour (m3, bands of 25)',
    x_axis_title_margin: 30,
    y_axis_title: 'Days',
    y_axis_title_margin: 50,
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
    groupby: ['source', 'building', 'task_kind'],
    metrics: [
      sql('COUNT(*)', 'Activities'),
      sql('ROUND(AVG(pour_concrete_m3), 1)', 'Avg pour m3'),
      sql('ROUND(AVG(planned_dur_d), 2)', 'Avg planned days'),
      sql('ROUND(AVG(actual_cal_days), 2)', 'Avg actual days'),
      sql('ROUND(AVG(planned_days_per_100m3), 2)', 'Planned days per 100 m3'),
      sql('ROUND(AVG(actual_days_per_100m3), 2)', 'Actual days per 100 m3'),
      sql('ROUND(AVG(m3_per_planned_day), 2)', 'm3 per planned day'),
      sql('ROUND(AVG(m3_per_actual_day), 2)', 'm3 per actual day'),
    ],
    all_columns: [],
    percent_metrics: [],
    adhoc_filters: filters(),
    order_by_cols: [],
    row_limit: 1000,
    order_desc: false,
    page_length: 0,
    include_search: true,
    show_cell_bars: false,
    allow_render_html: false,
  };
}

const MARKDOWN = [
  '**Rates by concrete volume** — how long decking, formwork, embeds under the slab and on top, curing and rebar take for the concrete volume of their pour.',
  '',
  '- Most of these activities carry no volume of their own. Each one is **linked to its pour** (the same WBS node, the pour number in its name, the ID stem, or the logic after it) and takes that pour\'s concrete m³. Only links the analysis trusts (`reliable_link = 1`) are charted.',
  '- **Days per 100 m³** = duration ÷ pour volume × 100. **m³ per day** = pour volume ÷ duration. Project A has actual dates, scenarios planned dates only.',
  '- Filter by **Source**, **Building**, **Level**, **Task kind** or **Link method**. The task kind comes from the activity name: check the *Embeds* split in the table if a kind looks wrong.',
  '- After loading a programme or scenario: Dashboards › **Update data**, then refresh this page.',
].join('\n');

export async function buildRatesDashboard(api: Superset) {
  const datasets = await api.call('GET', `/api/v1/dataset/${Superset.q('(page_size:200)')}`);
  const all: any[] = datasets.result ?? [];
  let ds = all.find((d) => d.table_name === DATASET);
  if (!ds) {
    // Added beside the analysis datasets: the same database and schema as the one the Compare dashboard reads.
    const base = all.find((d) => d.table_name === 'skyline_weekly') ?? all.find((d) => d.table_name === 'activity_facts');
    if (!base) throw new SupersetError(`Superset has no analysis datasets yet. Run Dashboards > Update data (build_analysis.py) and add its tables as datasets first.`, 409);
    const made = await api.call('POST', '/api/v1/dataset/', { database: base.database?.id, schema: base.schema ?? null, table_name: DATASET });
    ds = { id: made.id };
  }
  const datasource = `${ds.id}__table`;

  const listed = await api.call('GET', `/api/v1/dashboard/${Superset.q(`(filters:!((col:dashboard_title,opr:eq,value:'${DASHBOARD}')))`)}`);
  let dashboardId: number = listed.result?.[0]?.id;
  if (!dashboardId) dashboardId = (await api.call('POST', '/api/v1/dashboard/', { dashboard_title: DASHBOARD, published: true })).id;

  const specs: { name: string; viz: string; params: object }[] = [
    { name: 'Rates: days per 100 m3 of concrete, by task kind', viz: 'echarts_timeseries_bar', params: barByKind(datasource, [sql('AVG(planned_days_per_100m3)', 'Planned days per 100 m3'), sql('AVG(actual_days_per_100m3)', 'Actual days per 100 m3')], 'Days per 100 m3') },
    { name: 'Rates: m3 of concrete per day, by task kind', viz: 'echarts_timeseries_bar', params: barByKind(datasource, [sql('AVG(m3_per_planned_day)', 'm3 per planned day'), sql('AVG(m3_per_actual_day)', 'm3 per actual day')], 'm3 per day') },
    { name: 'Rates: days by concrete volume of the pour, by task kind', viz: 'echarts_timeseries_line', params: byVolumeBand(datasource) },
    { name: 'Rates: summary by source, building and task kind', viz: 'table', params: summary(datasource) },
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

  const row = (name: string, children: string[]) => ({ type: 'ROW', id: name, children, parents: ['ROOT_ID', 'GRID_ID'], meta: { background: 'BACKGROUND_TRANSPARENT' } });
  const chart = (id: number, parent: string, width: number, height: number) => ({ type: 'CHART', id: `CHART-${id}`, children: [], parents: ['ROOT_ID', 'GRID_ID', parent], meta: { chartId: id, width, height } });
  const layout: Record<string, unknown> = {
    DASHBOARD_VERSION_KEY: 'v2',
    ROOT_ID: { type: 'ROOT', id: 'ROOT_ID', children: ['GRID_ID'] },
    GRID_ID: { type: 'GRID', id: 'GRID_ID', children: ['ROW-help', 'ROW-0', 'ROW-1', 'ROW-2'], parents: ['ROOT_ID'] },
    'ROW-help': row('ROW-help', ['MARKDOWN-help']),
    'MARKDOWN-help': { type: 'MARKDOWN', id: 'MARKDOWN-help', children: [], parents: ['ROOT_ID', 'GRID_ID', 'ROW-help'], meta: { width: 12, height: 26, code: MARKDOWN } },
    'ROW-0': row('ROW-0', [`CHART-${ids[0]}`, `CHART-${ids[1]}`]),
    [`CHART-${ids[0]}`]: chart(ids[0], 'ROW-0', 6, 60),
    [`CHART-${ids[1]}`]: chart(ids[1], 'ROW-0', 6, 60),
    'ROW-1': row('ROW-1', [`CHART-${ids[2]}`]),
    [`CHART-${ids[2]}`]: chart(ids[2], 'ROW-1', 12, 64),
    'ROW-2': row('ROW-2', [`CHART-${ids[3]}`]),
    [`CHART-${ids[3]}`]: chart(ids[3], 'ROW-2', 12, 60),
  };

  const filter = (column: string, name: string) => ({
    id: `NATIVE_FILTER-rates-${column}`,
    name,
    filterType: 'filter_select',
    targets: [{ datasetId: ds.id, column: { name: column } }],
    controlValues: { multiSelect: true, enableEmptyFilter: false, defaultToFirstItem: false, inverseSelection: false, searchAllOptions: false },
    defaultDataMask: { extraFormData: {}, filterState: {} },
    cascadeParentIds: [],
    scope: { rootPath: ['ROOT_ID'], excluded: [] },
    type: 'NATIVE_FILTER',
    description: '',
  });
  const metadata = {
    native_filter_configuration: [filter('source', 'Source'), filter('building', 'Building'), filter('level', 'Level'), filter('task_kind', 'Task kind'), filter('link_method', 'Link method')],
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
