import type { ContentBlock } from './types'

const QUOTE_COMMAND = /^\/(?:当前任务|任务列表|切换任务|中断并新开|结束任务|检查报价接口|重置任务|current-task|task-list|switch-task|interrupt-and-new|finish-task)(?:\s|$)/i
const WAREHOUSE_CODE = /\b[A-Za-z]{2,5}\d{1,4}\b/
const MARGIN_CHANGE = /(?:毛利|利润|加点|统一按|方案\s*\d+\s*(?:按)?\s*\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*%)/i
const QUOTE_INTENT = /(?:报价|询价|运费|价格|多少钱|最便宜|最快|时效)/i
const SHIPPING_DETAIL = /(?:海运|空运|铁路|卡航|卡派|包税|不包税|自税|起运仓|发货仓|仓库|FBA|\d+(?:\.\d+)?\s*(?:kg|公斤|千克|cbm|方))/i
const TASK_CHANGE = /(?:改为|改成|换成|补充|新增|删除|排除|不要|只要|只看|只走|结束|完成)/i

export function shouldRouteHostedLogisticsQuote(input: string | ContentBlock[]): boolean {
  if (typeof input !== 'string') return false
  const text = input.trim()
  if (!text) return false
  return QUOTE_COMMAND.test(text)
    || WAREHOUSE_CODE.test(text)
    || MARGIN_CHANGE.test(text)
    || QUOTE_INTENT.test(text)
    || (TASK_CHANGE.test(text) && SHIPPING_DETAIL.test(text))
    || (SHIPPING_DETAIL.test(text) && /(?:美国|加拿大|欧洲|英国|德国|法国|意大利|西班牙|日本|澳洲|澳大利亚)/i.test(text))
}
