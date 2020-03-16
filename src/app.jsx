import $ from 'jquery'
import React, { useEffect } from 'react'
import ReactDOM from 'react-dom'
import { v4 as uuid } from 'uuid'
import sqlFormatter from 'sql-formatter'
import { Config } from '@karimsa/boa'
import { Pool as PostgresClient } from 'pg'
import ms from 'ms'
import numeral from 'numeral'
import * as Charts from 'react-chartjs-2'
import PropTypes from 'prop-types'

import { useAsync, useReducer, useAsyncAction, useClock } from './async'
import { Storage } from './storage'

const defaultQuery = sqlFormatter.format(`
	SELECT
		'line' as type,
		1 as x,
		1 as y
`)

const chartComponents = {
	line: Charts.Line,
	bar: Charts.Bar,
	pie: Charts.Pie,
	noop: () => null,
}

const chartColors = [
	'rgb(255, 99, 132)',
	'rgb(255, 159, 64)',
	'rgb(255, 205, 86)',
	'rgb(75, 192, 192)',
	'rgb(54, 162, 235)',
	'rgb(153, 102, 255)',
	'rgb(201, 203, 207)',
]

function Chart({ type, data, options }) {
	const Component = chartComponents[type] || chartComponents.noop
	return <Component data={data} options={options} />
}
Chart.propTypes = {
	type: PropTypes.string,
	data: PropTypes.object,
	options: PropTypes.object,
}

function findSubPlan(type, plan) {
	if (plan['Node Type'] === type) {
		return plan
	}
	if (plan.Plan) {
		return findSubPlan(type, plan.Plan)
	}
	if (plan.Plans) {
		for (const subPlan of plan.Plans) {
			const match = findSubPlan(type, subPlan)
			if (match) {
				return match
			}
		}
	}
}

function extractVariables(query) {
	const matches = []
	for (const [_, name, __, defaultValue] of query.matchAll(
		/{\s*(.*?)\s*(\|\s*(.*?))?\s*}/g,
	)) {
		matches.push({ name, defaultValue })
	}
	return matches
}

function cleanQuery(query, params) {
	query = query
		.split(/\n/g)
		.filter(line => !line.trim()[0].startsWith('--'))
		.join('\n')
	for (let i = 0; i < params.length; i++) {
		query = query.replace(
			new RegExp('{\\s*' + params[i].name + '.*?}'),
			'$' + (1 + i),
		)
	}
	return {
		text: query,
		values: params.map(p => p.value),
	}
}

function App() {
	const pgClientState = useAsync(async () => {
		const pgUser = Config.string('PgUser')
		const pgPass = Config.string('PgPass')
		const pgHost = Config.string('PgHost', 'www.eecs.uottawa.ca')
		const pgPort = Config.int('PgPort', 15432)

		console.warn(
			`Creating pg client to postgres://${pgUser}:****@${pgHost}:${pgPort}/group_8`,
		)
		const pg = new PostgresClient({
			user: pgUser,
			password: pgPass,
			database: 'group_8',
			host: pgHost,
			port: pgPort,
			query_timeout: 5000,
			max: 2,
		})
		await pg.query(`SELECT 1`)

		return pg
	})

	const [
		{
			id: selectedQueryID,
			name: queryName,
			query,
			queryParams,
			queryList,
			queryUpdatedAt,
		},
		queryDispatch,
	] = useReducer(
		{
			rename: (prev, { name }) => {
				let queryList = prev.queryList
				const id = prev.id || uuid()

				if (!prev.id) {
					queryList = [...queryList, { id, name }]
					Storage.set('query:' + id, prev.query)
				} else {
					queryList.forEach(query => {
						if (query.id === id) {
							query.name = name
						}
					})
				}

				Storage.set('query-list', queryList)

				return {
					...prev,
					id,
					name,
					query: prev.query,
					queryList,
				}
			},
			update: ({ id, queryParams, ...prev }, { query }) => {
				if (id) {
					Storage.set('query:' + id, query)
				}
				return {
					...prev,
					id,
					query,
					queryParams: extractVariables(query).map(param => ({
						name: param.name,
						value:
							queryParams.find(p => p.name === param)?.value ??
							param.defaultValue ??
							'',
					})),
					queryUpdatedAt: Date.now(),
				}
			},
			select: (prev, { id }) => {
				if (!id) {
					return {
						name: '',
						query: defaultQuery,
						queryList,
						queryParams: [],
					}
				}
				const query = prev.queryList.find(query => query.id === id)
				const queryText = Storage.get('query:' + id)
				return {
					id,
					name: query.name,
					query: queryText,
					queryParams: extractVariables(queryText).map(param => ({
						name: param.name,
						value: param.defaultValue ?? '',
					})),
					queryList,
				}
			},
			updateParam: (prev, { param, value }) => {
				return {
					...prev,
					queryParams: prev.queryParams.map(p => {
						if (p.name === param) {
							return { name: param, value }
						}
						return p
					}),
				}
			},
		},
		{
			name: '',
			query: defaultQuery,
			queryList: Storage.get('query-list') || [],
			queryParams: [],
		},
	)

	const cardRef = React.createRef()
	useEffect(() => {
		if (cardRef.current) {
			cardRef.current.setAttribute(
				'style',
				`${cardRef.current.getAttribute('style')}; width: ${$(
					cardRef.current,
				).width()}px !important; /* ${Math.random()} */`,
			)
		}
	}, [cardRef.current])

	const canvasRef = React.createRef()
	const [chartDataState, updateChart] = useAsyncAction(async () => {
		const queryStart = Date.now()
		const runnableQuery = cleanQuery(query, queryParams)
		const {
			rows: [
				{
					'QUERY PLAN': [{ Plan: winningPlan }],
				},
			],
		} = await pgClientState.result.query({
			text: `EXPLAIN (FORMAT JSON) ${runnableQuery.text}`,
			values: runnableQuery.values,
		})
		console.warn(winningPlan)

		const seqScanSize =
			findSubPlan('Seq Scan', winningPlan) && winningPlan['Plan Rows']
		if (seqScanSize >= 1e3) {
			throw new Error(
				`The result of this query is too large to display. ${numeral(
					seqScanSize,
				).format('0,0')} rows have been matched, but only 1000 are supported.`,
			)
		}

		const memSortSize = (findSubPlan('Sort', winningPlan) || {})['Plan Rows']
		if (memSortSize >= 1e4) {
			throw new Error(
				`This query causes an in-memory sort of ${numeral(memSortSize).format(
					'0,0',
				)} rows on the column${
					findSubPlan('Sort', winningPlan)['Sort Key'].length === 1 ? '' : 's'
				} "${findSubPlan('Sort', winningPlan)['Sort Key'].join(
					', ',
				)}". You can create an index or avoid the sort.`,
			)
		}

		const { rows } = await pgClientState.result.query(runnableQuery)
		const { type, x_label: xLabel, y_label: yLabel } = rows[0] || {
			type: 'line',
		}
		const isTable =
			!type || rows[0]?.x === undefined || rows[0]?.y === undefined

		return {
			duration: Date.now() - queryStart,
			planSuggestion: findSubPlan('Seq Scan', winningPlan)
				? `Your query causes a table scan on "${
						findSubPlan('Seq Scan', winningPlan)['Relation Name']
				  }". Create an index instead.`
				: findSubPlan('Sort', winningPlan)
				? `Your query triggers an in-memory sort on the column${
						findSubPlan('Sort', winningPlan)['Sort Key'].length === 1 ? '' : 's'
				  } "${findSubPlan('Sort', winningPlan)['Sort Key'].join(', ')}"`
				: null,
			isTable,
			rows,
			timeOfLastUpdate: Date.now(),
			chartType: type,
			data: {
				labels: type === 'line' ? [] : rows.map(row => row.x),
				datasets: [
					{
						backgroundColor: rows.map(
							(_, index) => chartColors[index % chartColors.length],
						),
						data: rows.map(row =>
							type === 'line' ? { x: row.x, y: row.y } : row.y,
						),
					},
				],
			},
			options: {
				responsive: true,
				scales: {
					xAxes: [
						{
							display: type !== 'pie',
							scaleLabel: {
								display: Boolean(xLabel),
								labelString: xLabel,
							},
						},
					],
					yAxes: [
						{
							display: type !== 'pie',
							scaleLabel: {
								display: Boolean(yLabel),
								labelString: yLabel,
							},
						},
					],
				},
				legend: {
					display: type === 'pie',
				},
			},
		}
	})
	useEffect(() => {
		if (query) {
			updateChart.fetch()
		}
	}, [query, queryParams, canvasRef.current, cardRef.current])
	useEffect(() => {
		if (chartDataState.status === 'idle') {
			const timer = setInterval(() => updateChart.fetch(), 1e2)
			return () => clearInterval(timer)
		}
	}, [canvasRef.current, cardRef.current, chartDataState])

	const now = useClock()
	const isLoading = pgClientState.status === 'loading'
	const error =
		pgClientState.error ||
		((!queryUpdatedAt || now - queryUpdatedAt >= 1e3) && chartDataState.error)

	return (
		<div className="d-flex align-items-center justify-content-center h-100 w-100">
			<div className="container-fluid">
				<div className="row">
					<div className="col">
						<h2 className="text-center mb-4">OLAP Dashboard</h2>
					</div>
				</div>

				{error && (
					<div className="row">
						<div className="col">
							<div className="alert alert-danger" role="alert">
								{String(error.message || error)}
							</div>
						</div>
					</div>
				)}

				<div className="row">
					<div className="col d-flex align-items-center justify-content-center">
						<div className="w-100">
							{isLoading && (
								<div className="spinner-border spinner-border-lg text-primary" />
							)}
							<div
								className="card border-top border-primary shadow w-100 mb-4"
								ref={cardRef}
								style={{ height: '60vh' }}
							>
								<div className="card-body table-responsive d-flex align-items-center justify-content-center">
									{!chartDataState.result?.isTable && (
										<Chart
											type={chartDataState.result?.chartType}
											data={chartDataState.result?.data}
											options={chartDataState.result?.options}
										/>
									)}

									{/* World's slowest table? Quite possibly. */}
									{chartDataState.result?.isTable &&
										(chartDataState.result.rows.length === 0 ? (
											<p className="mb-0 text-center">
												Query returned empty result
											</p>
										) : (
											<div>
												<table className="table table-striped mb-0">
													<thead className="thead-light">
														<tr>
															{Object.keys(chartDataState.result.rows[0]).map(
																key => (
																	<th key={key}>{key}</th>
																),
															)}
														</tr>
													</thead>
													<tbody>
														{chartDataState.result.rows
															.slice(0, 10)
															.map(row => (
																<tr key={Math.random()}>
																	{Object.keys(
																		chartDataState.result.rows[0],
																	).map(key => (
																		<td key={key}>{String(row[key])}</td>
																	))}
																</tr>
															))}
													</tbody>
												</table>

												{chartDataState.result.rows.length > 10 && (
													<p className="text-muted d-block pl-2">
														({chartDataState.result.rows.length - 10} additional
														rows hidden)
													</p>
												)}
											</div>
										))}
								</div>
							</div>

							{!chartDataState.error &&
								(function() {
									if (
										!chartDataState.result ||
										chartDataState.status === 'loading'
									) {
										return (
											<div className="alert alert-primary">
												Fetching new data ...
											</div>
										)
									}

									if (chartDataState.error) {
										return (
											<div className="alert alert-danger" role="alert">
												{String(chartDataState.error)}
											</div>
										)
									}

									if (chartDataState.result.planSuggestion) {
										return (
											<div className="alert alert-warning" role="alert">
												<strong>Warning: </strong>
												{String(chartDataState.result.planSuggestion)}
											</div>
										)
									}

									return (
										<div className="alert alert-success">
											<strong>All good!</strong> Query ran in{' '}
											{ms(chartDataState.result.duration)}.
										</div>
									)
								})()}
						</div>
					</div>

					<div className="col-4">
						<form>
							<div className="form-group">
								<select
									className="form-control"
									value={selectedQueryID}
									onChange={evt =>
										queryDispatch('select', { id: evt.target.value })
									}
								>
									<option value="">(New query)</option>
									{queryList.map(query => (
										<option key={query.id} value={query.id}>
											{query.name}
										</option>
									))}
								</select>
							</div>

							<div className="form-group">
								<input
									type="text"
									className="form-control"
									placeholder="Query name"
									value={queryName}
									onChange={evt =>
										queryDispatch('rename', { name: evt.target.value })
									}
								/>
							</div>

							<div className="form-group">
								<textarea
									className="form-control mb-2"
									value={query}
									onKeyUp={evt => {
										if (evt.which === 13 && evt.metaKey) {
											updateChart.fetch()
										}
									}}
									onChange={evt =>
										queryDispatch('update', { query: evt.target.value })
									}
									onBlur={() =>
										queryDispatch('update', {
											query: sqlFormatter.format(query),
										})
									}
									rows="10"
									disabled={isLoading}
								/>
							</div>

							{queryParams.length > 0 && <p>Parameters</p>}
							{queryParams.map(param => (
								<div className="form-group" key={param.name}>
									<label>{param.name}</label>
									<input
										type="text"
										className="form-control"
										value={param.value}
										onChange={evt =>
											queryDispatch('updateParam', {
												param: param.name,
												value: evt.target.value,
											})
										}
									/>
								</div>
							))}
						</form>
					</div>
				</div>
			</div>
		</div>
	)
}

ReactDOM.render(<App />, document.getElementById('app'))
