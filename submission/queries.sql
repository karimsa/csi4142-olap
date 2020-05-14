-- OLAP Dashboard
-- Course: CSI4142
-- Submission by Group 8

-- This material view helps keep queries simpler
-- and optimizes the read performance of the dashboard.
CREATE MATERIALIZED VIEW cross_join AS (
  SELECT
    crimes.*,
    dates.month,
    dates.year,
    dates.day_of_the_week,
    dates.day_of_the_month,
    dates.hour,
    dates.holidayName,
    locations.city,
    locations.neighbourhood
  FROM
    crimes
    INNER JOIN dates ON crimes.start_date_key = dates.key
    INNER JOIN locations ON crimes.location_key = locations.key
);

-- (Combined) Average severity per category in March 2016
-- Window stats for severity per category
-- Sliced to specific month-year
SELECT
  *,
  AVG(severity) OVER w AS avg_severity,
  STDDEV(severity) OVER w AS stddev_severity
FROM
  cross_join
WHERE
  month = 2
  AND year = 2016
  AND neighbourhood != '' WINDOW w AS (PARTITION BY neighbourhood)
LIMIT
  10;
;

-- (Combined) Number of most severe crimes in adjacent months
-- Windowing used to get adjacent month numbers
-- Iceberg used to limit data to most severe crimes
SELECT
  *,
  LEAD(num_crimes_this_month, -1) OVER w num_crimes_prev_month,
  LEAD(num_crimes_this_month) OVER w num_crimes_next_month
FROM
  (
    SELECT
      neighbourhood,
      month,
      COUNT(*) AS num_crimes_this_month
    FROM
      cross_join
    WHERE
      neighbourhood != ''
      AND severity > 14
    GROUP BY
      (neighbourhood, month)
  ) AS r WINDOW w AS ()
LIMIT
  10;
;

-- (Combined) Rollup by date, iceberg latest years
-- Rolled up by date
-- Iceberg of only last 5 years
SELECT
  year,
  month,
  day_of_the_month,
  AVG(severity) AS severity
FROM
  cross_join
WHERE
  year > 2015
GROUP BY
  ROLLUP(year, month, day_of_the_month)
LIMIT
  10;
;

-- (Dice) Subset of a crime type on dates
SELECT
  *,
  category as category,
  type as type,
  month AS month
FROM
  cross_join
WHERE
  month IN (12, 1, 2)
  AND type ~* 'theft-other|bldg'
  AND category ~* 'Burglary|Larceny'
LIMIT
  10;
;

-- (Dice) Subset of crime type of subset of a crime type
SELECT
  *,
  category as category,
  type as type,
  month AS month
FROM
  cross_join
WHERE
  month IN (12, 1, 2)
  AND type ~* 'theft-other| bldg'
  AND category ~* 'Burglary|Larceny'
  or is_traffic = false
LIMIT
  10 -- replace burglary and larceny as any other subcrime type;
;

-- (Dice) Subset of crimes during Dec, Jan, Feb
SELECT
  *,
  type as type,
  month AS month
FROM
  cross_join
WHERE
  month IN (12, 1, 2)
  AND type ~* 'Burglary|theft'
LIMIT
  10 -- replace burglary and theft as any other subcrime type;
;

-- (DrillDown) Total crimes by category of crime
SELECT
  COUNT(*) AS num_crimes,
  MIN(year) AS year,
  MIN(city) AS city,
  MIN(category) as category
FROM
  cross_join
WHERE
  year = 2016
  AND city = 'Vancouver'
  AND category = 'Larceny';
;

-- (DrillDown) Total crimes by neighbourhood
SELECT
  COUNT(*) AS num_crimes,
  MIN(year) AS year,
  MIN(city) AS city,
  MIN(neighbourhood) as neighbourhood
FROM
  cross_join
WHERE
  year = 2016
  AND city = 'Vancouver'
  AND neighbourhood = 'marpole';
;

-- (DrillDown) Total crimes in a city in a year
SELECT
  COUNT(*) AS num_crimes,
  MIN(year) AS year,
  MIN(city) AS city
FROM
  cross_join
WHERE
  year = 2016
  AND city = 'Vancouver';
;

-- (Iceberg) Neighbourhoods in Denver with highest theft
SELECT
  *
FROM
  (
    SELECT
      'bar' as type,
      neighbourhood as x,
      'Neighbourhood' as x_label,
      COUNT(*) :: float / 1000 as y,
      '# of crimes (in thousands)' as y_label
    FROM
      cross_join
    WHERE
      city = 'Denver'
      AND category = 'Larceny'
    GROUP BY
      neighbourhood
  ) AS r
WHERE
  r.y >= 0.8
ORDER BY
  r.y DESC;
;

-- (Iceberg) Neighbourhoods with most number of severe crimes
SELECT
  *
FROM
  (
    SELECT
      'bar' as type,
      neighbourhood AS x,
      COUNT(*) :: float / 1000 AS y,
      '# of crimes (in thousands)' as y_label
    FROM
      cross_join
    WHERE
      severity > 10
      AND neighbourhood != ''
    GROUP BY
      neighbourhood
  ) AS r
WHERE
  r.y > 1.2
ORDER BY
  r.y DESC;
;

-- (Iceberg) Neighbourhoods with the most nighttime crimes
SELECT
  *
FROM
  (
    SELECT
      'bar' as type,
      neighbourhood as x,
      'Neighbourhood' as x_label,
      COUNT(*) :: float / 1000 as y,
      '# of crimes (in thousands)' as y_label
    FROM
      cross_join
    WHERE
      is_nighttime = TRUE
    GROUP BY
      neighbourhood
    ORDER BY
      y DESC
  ) AS r
WHERE
  r.y >= 6;
;

-- (RollUp) Crime severity rolled up by date
SELECT
  year,
  month,
  day_of_the_month,
  AVG(severity) AS severity
FROM
  cross_join
GROUP BY
  ROLLUP(year, month, day_of_the_month)
LIMIT
  10;
;

-- (RollUp) Crime severity rolled up by location
SELECT
  province,
  city,
  neighbourhood,
  AVG(severity) AS severity
FROM
  cross_join
GROUP BY
  ROLLUP(province, city, neighbourhood)
LIMIT
  10;
;

-- (RollUp) Crimes rolled up by crime type
SELECT
  category,
  type,
  COUNT(*) as num_crimes
FROM
  cross_join
GROUP BY
  ROLLUP(category, type)
LIMIT
  10;
;

-- (Slice) Crime per city in March 2016
-- The 'GROUP BY' is added to visualize
-- the slice
-- Slice removes date
SELECT
  'pie' as type,
  COUNT(*) as y,
  '# of crimes' as y_label,
  city as x,
  'City' as x_label
FROM
  cross_join
WHERE
  month = 2
  AND year = 2016
GROUP BY
  city;
;

-- (Slice) Crime per month in specific neighbourhood
-- GROUP BY used for visualization
-- Slicing to remove location by limiting neighbourhood
SELECT
  'bar' as type,
  month as x,
  COUNT(*) as y
FROM
  cross_join
WHERE
  neighbourhood = 'central business district'
GROUP BY
  month;
;

-- (Slice) Crimes per neighbourhood in Denver
-- Slice removes location
SELECT
  'bar' as type,
  neighbourhood as x,
  'Neighbourhoods' as x_label,
  COUNT(*) :: float / 1000 as y,
  '# of crimes (in thousands)' as y_label
FROM
  cross_join
WHERE
  city = 'Denver'
GROUP by
  neighbourhood;
;

-- (WINDOW) Average severity over neighbourhood
SELECT
  *,
  AVG(severity) OVER w AS avg_severity,
  STDDEV(severity) OVER w AS stddev_severity
FROM
  cross_join
WHERE
  neighbourhood != '' WINDOW w AS (PARTITION BY neighbourhood)
LIMIT
  10;
;

-- (WINDOW) Severity stats windowed over category
SELECT
  *,
  AVG(severity) OVER W AS avg_severity_of_category,
  MAX(severity) OVER W AS max_severity_of_category,
  MIN(severity) OVER W AS min_severity_of_category
FROM
  cross_join WINDOW w AS (PARTITION BY category)
LIMIT
  10;
;

-- (WINDOW) Total number of crimes in prev/next month
SELECT
  *,
  LEAD(num_crimes_this_month, -1) OVER w num_crimes_prev_month,
  LEAD(num_crimes_this_month) OVER w num_crimes_next_month
FROM
  (
    SELECT
      neighbourhood,
      month,
      COUNT(*) AS num_crimes_this_month
    FROM
      cross_join
    WHERE
      neighbourhood != ''
    GROUP BY
      (neighbourhood, month)
  ) AS r WINDOW w AS ()
LIMIT
  10;
;

-- (Windowing) Average severity per neighbourhood
SELECT
  'bar' as type,
  MIN(avg_neighbourhood_severity) as y,
  neighbourhood as x
FROM
  (
    -- This is the actual windowing query, it is
    -- wrapped with a sub-select for visualization purposes
    SELECT
      *,
      AVG(severity) OVER (PARTITION BY neighbourhood) AS avg_neighbourhood_severity
    FROM
      cross_join
    WHERE
      neighbourhood != ''
  ) AS r
GROUP BY
  x
ORDER BY
  y DESC;
;

-- (Windowing) Number of traffic accidents by neighbourhood
SELECT
  'bar' as type,
  neighbourhood AS x,
  MIN(total_neighbourhood_traffic_crimes) AS y
FROM
  (
    -- This is the actual windowing query,
    -- the surrounding sub-select is for visualization
    SELECT
      *,
      COUNT(*) FILTER(
        WHERE
          is_traffic = TRUE
      ) OVER (PARTITION BY neighbourhood) AS total_neighbourhood_traffic_crimes
    FROM
      cross_join
    WHERE
      neighbourhood != ''
  ) AS r
GROUP BY
  x
ORDER BY
  y DESC
LIMIT
  10;
;

-- (Windowing) Total crimes by neighbourhood
SELECT
  'bar' as type,
  neighbourhood AS x,
  MIN(total_neighbourhood_crimes) AS y
FROM
  (
    -- This is the actual windowing query,
    -- the surrounding sub-select is for visualization
    SELECT
      *,
      COUNT(*) OVER (PARTITION BY neighbourhood) AS total_neighbourhood_crimes
    FROM
      cross_join
    WHERE
      neighbourhood != ''
  ) AS r
GROUP BY
  x
ORDER BY
  y DESC
LIMIT
  10;
;