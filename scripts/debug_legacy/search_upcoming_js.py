import re

with open("E:/DT.t/tzel/upcoming-sales.js", "r") as f:
    js_content = f.read()

# Let's find all occurrences of fetch or docs or links
print("Found lines containing docs/ or appraisal:")
for line in js_content.splitlines():
    if "docs/" in line or "appraisal" in line or "Expr3" in line or "COUNT" in line:
        print(line.strip())
