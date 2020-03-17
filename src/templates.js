export function extractVariables(query) {
	const matches = []
	for (const [_, name, __, defaultValue] of query.matchAll(
		/{\s*(.*?)\s*(\|\s*(.*?))?\s*}/g,
	)) {
		matches.push({ name, defaultValue })
	}
	return matches
}

export function cleanQuery(query, params) {
	query = query
		.split(/\n/g)
		.filter(line => {
			line = line.trim()
			return line && !line[0].startsWith('--')
		})
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
