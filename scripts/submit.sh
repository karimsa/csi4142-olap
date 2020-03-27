#!/bin/bash -ex -o pipefail

# generate 'queries.sql'
node "$(dirname $0)/generate-sql.js"

# generate full submission
tmp="$(mktemp -d)"
rsync -a "$(dirname $0)/.." "${tmp}/dashboard" --exclude node_modules --exclude .git --exclude .pgdata
mv "${tmp}/dashboard/submission/images" "${tmp}/dashboard/submission/queries.sql" "${tmp}/"
rm -rf ${tmp}/dashboard/{dist,.cache,.pgdata,node_modules,submission,.git}
zip -r "submission.zip" ${tmp}

# cleanup
rm -rf "$tmp"
