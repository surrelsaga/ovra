// Owner: Agent E. One consent question as a radio group.
import type { PrivacySettings } from '@shared/types'
import { ChoiceGroup } from '../ui'
import type { ConsentQuestion } from './consent'

export function ConsentField(props: {
  question: ConsentQuestion
  answers: PrivacySettings
  onChange: (patch: Partial<PrivacySettings>) => void
}): React.JSX.Element {
  const { question: q, answers, onChange } = props
  const index = q.options.findIndex((o) => o.value === answers[q.key])
  return (
    <ChoiceGroup
      legend={q.legend}
      description={q.description}
      name={q.key}
      required={q.required}
      columns={q.options.length > 2 ? 3 : 2}
      options={q.options.map((o, i) => ({ value: i, label: o.label, hint: o.hint }))}
      value={index === -1 ? null : index}
      onChange={(i) => onChange({ [q.key]: q.options[i].value })}
    />
  )
}
