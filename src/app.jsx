import { Buffer } from 'buffer'

import $ from 'jquery'
import React, { useState, useMemo, useEffect } from 'react'
import ReactDOM from 'react-dom'
import sqlFormatter from 'sql-formatter'
import { Config } from '@karimsa/boa'
import { Pool as PostgresClient } from 'pg'
import { Chart } from 'chart.js'
import ms from 'ms'

import { useAsync, useReducer } from './async'

function findSubPlan(type, plan) {
	if (plan['Node Type'] === type) {
		return plan
	}
	if (plan.Plan) {
		return findSubPlan(type, plan.Plan)
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
		})
		await pg.query(`SELECT 1`)

		return pg
	})

	const [{ name: queryName, query }, queryDispatch] = useReducer(
		{
			rename: (prev, { name }) => {
				const id = Buffer.from(name).toString('hex')

				if (prev.id) {
					localStorage.removeItem('query:' + prev.id)
				}
				localStorage.setItem('query:' + id, prev.query)

				return {
					id,
					name,
					query: prev.query,
				}
			},
			update: ({ id, name }, { query }) => {
				localStorage.setItem('query:' + id, query)
				return {
					id,
					name,
					query,
				}
			},
		},
		{
			name: '',
			query: sqlFormatter.format(`
			SELECT
				'line' as type,
				1 as x,
				1 as y
		`),
		},
	)

	useEffect(() => {
		if (queryName.prev) {
			localStorage.removeItem('query:' + Buffer.from(queryName).toString('hex'))
		}
		localStorage.setItem(
			'query:' + Buffer.from(queryName).toString('hex'),
			query,
		)
	}, [queryName])
	useEffect(() => {
		localStorage.setItem(
			'query:' + Buffer.from(queryName).toString('hex'),
			query,
		)
	}, [query])

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
	const chartDataState = useAsync(async () => {
		if (pgClientState.result && cardRef.current && canvasRef.current) {
			const queryStart = Date.now()
			const { rows } = await pgClientState.result.query(
				query.includes('LIMIT ') ? query : query + ' LIMIT 100',
			)
			const {
				rows: [
					{
						'QUERY PLAN': [winningPlan],
					},
				],
			} = await pgClientState.result.query(`EXPLAIN (FORMAT JSON) ${query}`)

			console.warn(winningPlan)

			const { type, x_label: xLabel, y_label: yLabel } = rows[0] || {
				type: 'line',
			}
			const isTable =
				!type || rows[0]?.x === undefined || rows[0]?.y === undefined

			if (!isTable) {
				const chart = new Chart(canvasRef.current.getContext('2d'), {
					type,
					data: {
						datasets: [
							{
								data: rows.map(row => ({ x: row.x, y: row.y })),
							},
						],
					},
					options: {
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
				})
				chart.render()
			}

			return {
				duration: Date.now() - queryStart,
				planSuggestion: findSubPlan('Seq Scan', winningPlan)
					? `Your query causes a table scan on "${
							findSubPlan('Seq Scan', winningPlan)['Relation Name']
					  }". Create an index instead.`
					: null,
				isTable,
				rows,
			}
		}
	}, [query, pgClientState.result, cardRef.current, canvasRef.current])

	const isLoading = pgClientState.status === 'loading'
	const error = pgClientState.error

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
								style={{ height: '40vh' }}
							>
								<div className="card-body table-responsive">
									{/* World's slowest table? Quite possibly. */}
									{chartDataState.result?.isTable ? (
										chartDataState.result.rows.length === 0 ? (
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
																		<td key={key}>{row[key]}</td>
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
										)
									) : (
										<canvas ref={canvasRef} />
									)}
								</div>
							</div>

							{(function() {
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
								<select className="form-control">
									<option>(New query)</option>
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
									onChange={evt => {
										let value = evt.target.value
										const which = evt.nativeEvent.which

										if (which === ','.charCodeAt(0)) {
											value = sqlFormatter.format(value)
										}

										queryDispatch('update', { query: value })
									}}
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
