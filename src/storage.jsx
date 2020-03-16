import * as fs from 'fs'
import * as path from 'path'

const memory = new Map()
const dataPath = path.resolve(process.cwd(), 'data.json')
const persisted = JSON.parse(fs.readFileSync(dataPath, 'utf8'))

for (const row of persisted) {
	memory.set(row.key, row)
}

export const Storage = {
	get: key => {
		const node = memory.get(key)
		return node?.value
	},
	set: (key, value) => {
		const node = memory.get(key) ?? { key, value }
		if (!memory.has(key)) {
			memory.set(key, node)
			persisted.push(node)
		} else {
			node.value = value
		}

		// Slow, but reliable + readable
		fs.writeFileSync(dataPath, JSON.stringify(persisted, null, '\t'))
	},
}
