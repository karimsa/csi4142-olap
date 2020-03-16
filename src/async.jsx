import { useState, useEffect } from 'react'

const kPromise = Symbol('promise')

function objectReducer(actions, state, action) {
	if (typeof actions[action.type] !== 'function') {
		throw new Error(`Unknown action type: ${action.type}`)
	}
	return actions[action.type](state, action)
}

export function co(gen) {
	return function(...args) {
		let canceled = false
		const promise = (async function() {
			let it = gen(...args)
			let lastResult

			/* eslint no-unmodified-loop-condition: off */
			while (!canceled) {
				const { value, done } = it.next(lastResult)
				lastResult = await value
				if (done) {
					break
				}
			}

			return lastResult
		})()
		promise.cancel = () => {
			canceled = true
		}
		return promise
	}
}

export function useReducer(reducer, initialState) {
	if (typeof reducer === 'object') {
		const [state, dispatch] = useReducer(
			objectReducer.bind(null, reducer),
			initialState,
		)
		return [state, (type, action) => dispatch({ type, ...action })]
	}

	const [state, setState] = useState(initialState)
	return [
		state,
		action => {
			const nextState = reducer(state, action)
			setState(nextState)
		},
	]
}

export function useAsyncAction(fn, deps) {
	if (fn.constructor.name === 'GeneratorFunction') {
		return useAsyncAction(co(fn), deps)
	}

	const [asyncArgs, setAsyncArgs] = useState()
	const [state, dispatch] = useReducer(
		(state, action) => {
			switch (action.type) {
				case 'FETCH':
					{
						const promise = state[kPromise]
						if (promise && promise.cancel) {
							promise.cancel()
						}
						// if (state.status === 'inprogress') {
						// 	throw new Error(
						// 		`Cannot re-fetch async action that is already inprogress`,
						// 	)
						// }
						setAsyncArgs(action.args)
					}
					return {
						status: 'inprogress',
						result: state.result,
						error: state.error,
					}

				case 'FORCE_FETCH':
					setAsyncArgs(action.args)
					return {
						status: 'inprogress',
						result: state.result,
						error: state.error,
					}

				case 'SET_RESULT':
					return {
						status: 'success',
						result: action.result,
					}

				case 'ERROR':
					return {
						status: 'error',
						error: action.error,
						result: state.result,
					}

				case 'CANCEL':
					const promise = state[kPromise]
					if (promise && promise.cancel) {
						promise.cancel()
					}
					return {
						status: 'canceled',
						result: state.result,
					}

				case 'RESET':
					return {
						status: 'idle',
						result: state.result,
					}

				default:
					throw new Error(
						`Unexpected action received by reducer: ${action.type}`,
					)
			}
		},
		{
			status: 'idle',
		},
	)
	useEffect(() => {
		if (asyncArgs) {
			let canceled = false
			const promise = Promise.resolve(fn(...asyncArgs))
			promise
				.then(result => {
					if (!canceled) {
						dispatch({ type: 'SET_RESULT', result })
					}
				})
				.catch(error => {
					if (!canceled) {
						dispatch({ type: 'ERROR', error })
					}
				})

			return () => {
				if (promise.cancel) {
					promise.cancel()
				}
				canceled = true
			}
		}
	}, [asyncArgs])
	if (deps) {
		useEffect(() => {
			if (state.status !== 'inprogress') {
				dispatch({ type: 'FETCH', args: deps })
				return () => dispatch({ type: 'CANCEL' })
			}
		}, deps)
	}

	return [
		state,
		{
			fetch: (...args) => dispatch({ type: 'FETCH', args }),
			forceFetch: (...args) => dispatch({ type: 'FORCE_FETCH', args }),
			forceSet: result => dispatch({ type: 'SET_RESULT', result }),
			reset: () => dispatch({ type: 'RESET' }),
			cancel: () => dispatch({ type: 'CANCEL' }),
		},
	]
}

export function useAsync(fn, deps) {
	const [state, actions] = useAsyncAction(fn, deps)
	if (deps === undefined && state.status === 'idle') {
		actions.fetch()
	}
	return state
}

export function useAsyncActions(handlers) {
	return useAsyncAction(function(action, ...args) {
		return handlers[action].apply(this, args)
	})
}

export function useClock(frequency = 16) {
	const [_, setClock] = useState()
	useEffect(() => {
		const timer = setTimeout(() => setClock(Date.now()), frequency)
		return () => clearTimeout(timer)
	})
	return Date.now()
}
