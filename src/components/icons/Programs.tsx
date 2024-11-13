import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" {...props}>
    <g clipPath="url(#a)">
      <path
        d="M4.945 6h-2v14a2 2 0 0 0 2 2h14v-2h-14V6Zm16-4h-12a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Zm-1 9h-10V9h10v2Zm-4 4h-6v-2h6v2Zm4-8h-10V5h10v2Z"
      />
    </g>
    <defs>
      <clipPath id="a">
        <path d="M.945 0h24v24h-24z" />
      </clipPath>
    </defs>
  </svg>
)
export default SvgComponent
