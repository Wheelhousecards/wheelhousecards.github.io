#!/bin/sh
# Run before each push: tags every script and stylesheet link with a new version
# so browsers load the latest files instead of an old saved copy.
v=$(date +%Y%m%d%H%M%S)
sed -i -E "s#(assets/[a-z-]+\.(js|css))(\?v=[0-9]+)?#\1?v=$v#g" index.html staff.html
sed -i -E "s#(from \"\./[a-z-]+\.js)(\?v=[0-9]+)?\"#\1?v=$v\"#g" assets/*.js
echo "stamped $v"
