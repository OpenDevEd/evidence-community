import * as React from "react"
import { SVGProps } from "react"
const SvgComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" {...props}>
    <path
      fillRule="evenodd"
      d="M9.962 1.802a9.25 9.25 0 1 0 10.181 10.181A7.25 7.25 0 1 1 9.962 1.802ZM.195 11C.195 5.063 5.008.25 10.945.25c.716 0 1.075.571 1.137 1.026.059.438-.103.995-.606 1.299a5.75 5.75 0 1 0 7.894 7.894c.304-.503.86-.665 1.299-.606.454.062 1.026.42 1.026 1.137 0 5.937-4.813 10.75-10.75 10.75S.195 16.937.195 11Z"
      clipRule="evenodd"
    />
  </svg>
)
export default SvgComponent
