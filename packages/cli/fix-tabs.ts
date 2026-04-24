import * as fs from "node:fs"
import * as path from "node:path"

const file = path.join(process.cwd(), "src/tui/components/design-system/Tabs.tsx")
let c = fs.readFileSync(file, "utf-8")
c = c.replace(/key\.rightArrowArrow/g, "key.rightArrow")
c = c.replace(/key\.leftArrowArrow/g, "key.leftArrow")
fs.writeFileSync(file, c)
console.log("Fixed Tabs.tsx")
