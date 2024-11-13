import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" {...props}>
    <g clipPath="url(#a)">
      <path
        d="M8.236 20.824 2.945 22l1.176-5.291A9.956 9.956 0 0 1 2.945 12c0-5.523 4.477-10 10-10s10 4.477 10 10-4.477 10-10 10a9.955 9.955 0 0 1-4.71-1.176Z"
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
