import { useState } from 'react'
import {
  COMMAND_METADATA,
  describeEncodingRule,
  describeTransactions,
} from '../../legacy/command-metadata'
import ControlTooltip from '../help/ControlTooltip'
import TechnicalTerm from '../term/TechnicalTerm'
import { ChevronDownIcon, ChevronUpIcon } from '../icons/Icon'

/**
 * Read-only PMBus command reference.
 *
 * Deliberately has NO selection state and NO side effects: choosing a command
 * cannot reliably derive the payload format (device datasheet or VOUT_MODE
 * decides), so this panel only displays command code, transactions, data type,
 * units, encoding-rule source, spec section and the metadata note. It never
 * switches mode, injects parameters, or rewrites raw.
 */
export default function CommandReference() {
  const [open, setOpen] = useState(false)
  const commands = Object.values(COMMAND_METADATA)

  return (
    <section aria-label="命令参考" data-testid="command-reference" className="px-4 py-2 sm:px-0">
      <ControlTooltip help="command-ref-toggle" params={{ count: commands.length }}>
        {(triggerProps) => (
          <button
            {...triggerProps}
            type="button"
            id="command-reference-toggle"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="command-ref-button flex h-10 w-full items-center justify-between rounded-lg px-4 text-left text-sm transition-colors"
          >
            <span className="font-medium">命令参考（只读）</span>
            <span className="inline-flex" aria-hidden="true">
              {open ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
            </span>
          </button>
        )}
      </ControlTooltip>

      {open && (
        <div className="command-ref-table-shell mt-2 overflow-x-auto rounded-lg">
          <p className="command-ref-hint px-3 pt-2 text-xs">
            纯计算器不依赖命令选择：命令选择不能可靠推导数据格式——器件数据手册或{' '}
            <TechnicalTerm termId="vout-mode" />
            决定格式。此面板只显示命令码、事务、数据类型、单位、格式来源与说明，不参与模式切换、
            参数注入或结果计算。
          </p>

          <table className="w-full min-w-[880px] text-left text-xs">
            <thead>
              <tr className="command-ref-th">
                <th className="px-3 py-2 font-semibold">命令</th>
                <th className="px-3 py-2 font-semibold">命令码</th>
                <th className="px-3 py-2 font-semibold">
                  <TechnicalTerm termId="transaction">事务</TechnicalTerm>
                </th>
                <th className="px-3 py-2 font-semibold">数据类型</th>
                <th className="px-3 py-2 font-semibold">单位</th>
                <th className="px-3 py-2 font-semibold">格式来源</th>
                <th className="px-3 py-2 font-semibold">规范章节</th>
                <th className="px-3 py-2 font-semibold">说明</th>
              </tr>
            </thead>
            <tbody>
              {commands.map((cmd) => (
                <tr
                  key={cmd.key}
                  data-command-key={cmd.key}
                  data-command-note={cmd.note ?? ''}
                  className="command-ref-row"
                >
                  <td className="px-3 py-2 font-medium">{cmd.label}</td>
                  <td className="px-3 py-2 font-mono">
                    0x{cmd.cmd.toString(16).toUpperCase().padStart(2, '0')}
                  </td>
                  <td className="px-3 py-2">{describeTransactions(cmd.transactions)}</td>
                  <td className="px-3 py-2">
                    {cmd.valueType === 'scalar'
                      ? '数值'
                      : cmd.valueType === 'status'
                        ? '状态位'
                        : 'Block 块'}
                  </td>
                  <td className="px-3 py-2">{cmd.units}</td>
                  <td className="px-3 py-2">{describeEncodingRule(cmd.encodingRule)}</td>
                  <td className="px-3 py-2">{cmd.spec}</td>
                  <td className="command-ref-note px-3 py-2">{cmd.note ? cmd.note : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
