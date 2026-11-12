#!/bin/sh
# Run before each push: tags every script and stylesheet link with a new version
# so browsers load the latest files instead of an old saved copy.
v=$(date +%Y%m%d%H%M%S)
sed -i -E "s#(assets/[a-z-]+\.(js|css))(\?v=[0-9]+)?#\1?v=$v#g" index.html staff.html
sed -i -E "s#(from \"\./[a-z-]+\.js)(\?v=[0-9]+)?\"#\1?v=$v\"#g" assets/*.js
echo "stamped $v"
# Customer link with "consignment" in it: wheelhousecards.github.io/consignment serves the same portal.
mkdir -p consignment
sed 's#<head>#<head>\n<base href="/">#' index.html > consignment/index.html
# Staff link: wheelhousecards.github.io/consignment/staff serves the staff app.
mkdir -p consignment/staff
sed 's#<head>#<head>\n<base href="/">#' staff.html > consignment/staff/index.html
