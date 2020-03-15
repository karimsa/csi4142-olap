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

import { useAsync, useReducer, useAsyncAction, useClock } from './async'
import { Storage } from './storage'

const defaultQuery = sqlFormatter.format(`
	SELECT
		'line' as type,
		1 as x,
		1 as y
`)

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

function App() {
	const pgClientState = useAsync(async () => {
		const pgUser = Config.string('PgUser')
		const pgPass = Config.string('PgPass')

		const pg = new PostgresClient({
			user: pgUser,
			password: pgPass,
			database: 'group_8',
			host: 'www.eecs.uottawa.ca',
			port: 15432,
			query_timeout: 5000,
		})
		await pg.query(`SELECT 1`)

		return pg
	})

	const [
		{ id: selectedQueryID, name: queryName, query, queryList, queryUpdatedAt },
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

				Storage.set('query-list', JSON.stringify(queryList))

				return {
					id,
					name,
					query: prev.query,
					queryList,
				}
			},
			update: ({ id, name, queryList }, { query }) => {
				if (id) {
					Storage.set('query:' + id, query)
				}
				return {
					id,
					name,
					query,
					queryList,
					queryUpdatedAt: Date.now(),
				}
			},
			select: (prev, { id }) => {
				if (!id) {
					return {
						name: '',
						query: defaultQuery,
						queryList,
					}
				}
				const query = prev.queryList.find(query => query.id === id)
				return {
					id,
					name: query.name,
					query: Storage.get('query:' + id),
					queryList,
				}
			},
		},
		{
			name: '',
			query: defaultQuery,
			queryList: JSON.parse(Storage.get('query-list')) || [],
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
		const {
			rows: [
				{
					'QUERY PLAN': [{ Plan: winningPlan }],
				},
			],
		} = await pgClientState.result.query(`EXPLAIN (FORMAT JSON) ${query}`)
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
		if (memSortSize >= 1e3) {
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

		const { rows } = await pgClientState.result.query(query)
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
				labels: type === 'bar' ? rows.map(row => row.x) : [],
				datasets: [
					{
						data: rows.map(row =>
							type === 'bar' ? row.y : { x: row.x, y: row.y },
						),
					},
				],
			},
			options: {
				responsive: true,
				scales: {
					xAxes: [
						{
							display: true,
							scaleLabel: {
								display: Boolean(xLabel),
								labelString: xLabel,
							},
						},
					],
					yAxes: [
						{
							display: true,
							scaleLabel: {
								display: Boolean(yLabel),
								labelString: yLabel,
							},
						},
					],
				},
				legend: {
					display: false,
				},
			},
		}
	})
	useEffect(() => {
		if (query) {
			updateChart.fetch()
		}
	}, [query, canvasRef.current, cardRef.current])
	useEffect(() => {
		if (chartDataState.status === 'idle') {
			const timer = setInterval(() => updateChart.fetch(), 1e2)
			return () => clearInterval(timer)
		}
	}, [canvasRef.current, cardRef.current, chartDataState])

	const now = useClock()
	const isLoading = pgClientState.status === 'loading'
	const error =
		pgClientState.error || (now - queryUpdatedAt >= 1e3 && chartDataState.error)

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
								<div className="card-body table-responsive">
									{/* <canvas
										ref={canvasRef}
										className={chartDataState.result?.isTable ? 'd-none' : ''}
									/> */}

									{chartDataState.result?.chartType === 'line' && (
										<Charts.Line
											data={chartDataState.result.data}
											options={chartDataState.result.options}
										/>
									)}
									{chartDataState.result?.chartType === 'bar' && (
										<Charts.Bar
											data={chartDataState.result.data}
											options={chartDataState.result.options}
										/>
									)}

									{/* World's slowest table? Quite possibly. */}
									{chartDataState.result?.isTable &&
										(chartDataState.result.rows.length === 0 ? (
											<p className="mb-0">Query returned empty result</p>
										) : (
											<React.Fragment>
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
													<caption className="text-muted d-block pl-2">
														({chartDataState.result.rows.length - 10} additional
														rows hidden)
													</caption>
												)}
											</React.Fragment>
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
						</form>
					</div>
				</div>
			</div>
		</div>
	)
}

ReactDOM.render(<App />, document.getElementById('app'))
