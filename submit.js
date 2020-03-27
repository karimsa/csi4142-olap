#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const sqlFormatter = require('sql-formatter')

require('@babel/register')
const data = require('./data.json')
const { extractVariables } = require('./src/templates')
const queryList = data.find(row => row.key === 'query-list').value

function serialize(value) {
	if (value.match(/^[0-9.]+$/)) {
		return value
	}

	value = JSON.stringify(value).substr(1)
	value = value.substr(0, value.length - 1)
	value = "'" + value + "'"
	return value
}

fs.writeFileSync(
	path.resolve(__dirname, 'submission', 'queries.sql'),
	[
		'-- OLAP Dashboard',
		'-- Course: CSI4142',
		'-- Submission by Group 8',
		'',
		'',
	].join('\n') +
		sqlFormatter.format(`
		-- This material view helps keep queries simpler
		-- and optimizes the read performance of the dashboard.
		CREATE MATERIALIZED VIEW
			cross_join
		AS (
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
		);`) +
		'\n' +
		queryList
			.map(row => {
				let query = data.find(entry => entry.key === `query:${row.id}`).value
				const vars = extractVariables(query)

				for (const { name, defaultValue } of vars) {
					if (defaultValue == null) {
						throw new Error(
							`Query ${row.name} is missing default value for ${name}`,
						)
					}
					query = query.replace(
						new RegExp('{\\s*' + name + '.*?}'),
						serialize(defaultValue),
					)
				}

				return ['', '-- ' + row.name, sqlFormatter.format(query) + ';'].join(
					'\n',
				)
			})
			.join('\n'),
)
