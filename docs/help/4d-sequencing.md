<!-- order: 7 -->
# 4D Sequencing

Link programme activities to model objects, then play the build over time. You need a model and a programme loaded first (see [Inputs](inputs.md)).

## The idea

1. A **link group** says which tasks go with which objects.
2. An **appearance profile** says how those objects look before, during and after their task.
3. The **timeline** moves through time and the model changes with it.

## Link Groups

A link group pairs tasks with objects.

- **Task filters** pick the tasks: by activity code, user field, or code or name.
- **Object filters** pick the objects: by any property.
- **Match rules** pair a task field with an object property, for example the task's *Zone* with the object's *Level*. Combine rules with AND or OR.

The counts of linked tasks and objects update as you change the rules. Check them: a group that links nothing shows zero.

## Appearance Profiles

How linked objects look at each stage of their task.

- **Install**: objects appear as the task runs. **Remove**: they disappear. **Maintain**: they are shown throughout.
- Set a **colour and opacity** for each stage (before, during, after).
- **Growth** animates objects in (drop, slide in, bottom to top) and out (lift up, slide away).

## The timeline

The bar along the bottom of the page.

- **Play**, **step** and **scrub** by hour, day, week, month or year.
- **Jump to date** goes straight to a day.
- Choose **planned** or **actual** dates.
- Use **Settings › 4D timeline** to zoom, follow the date while stepping, change speed and choose which rows show.

## Looking at the result

- **Colour modes** (per view): appearance profiles, original colours, or colour by a property.
- **Split view**: for example planned on one side and actual on the other, or two projects compared with a slider.
- **Search sets**: the same sets as on the Models page, to select and isolate objects while you sequence.
- **Label**: an on-screen date label placed on a 3 × 3 grid.
- **Tags**: callouts on objects built from task fields and object properties.
- **Tasks** panel: the tasks active at the current date, tinted with their stage colour.

## Exporting

**Export** records the timeline over a date range step by step, with the 3D views, label, tags, an optional progress bar and a tasks table. Save the result as **PNG images** or an **MP4 video** made in your browser.
