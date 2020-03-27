# CSI4142 / OLAP Dashboard

Directory layout:

 - `dashboard`: the source code for the dashboard.
 - `images`: screenshots for all queries being run as well as visualizations.
 - `queries.sql`: a SQL file with all the queries.

Most of the queries return table-formatted results (as seen in the photos) since
that is what made the most sense for those queries. However, some queries have been
wrapped with an additional SQL query to perform an aggregation that makes it easier
to visualize the results.

If the query projects any fields as 'x', 'y', and 'type' columns, it will be visualized
by our dashboard. Proof of this is provided in our visualizations.
