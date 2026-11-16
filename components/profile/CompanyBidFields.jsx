import { PROFILE_LIMITS as LIMITS } from '@/lib/profile-validation';

export default function CompanyBidFields({ profile, onChange, errors = {}, disabled = false }) {
    function error(path) {
        return errors[path] ? <span className="profile-field-error" id={`error-${path}`} role="alert">{errors[path]}</span> : null;
    }
    function inputProps(path) {
        return { id: path, disabled, 'aria-invalid': Boolean(errors[path]), 'aria-describedby': errors[path] ? `error-${path}` : undefined };
    }
    const projects = profile.past_projects || [];
    function setProject(index, field, value) {
        onChange('past_projects', projects.map((item, i) => i === index ? { ...item, [field]: value } : item));
    }
    return <section className="profile-card" aria-labelledby="company-bid-heading">
        <div className="profile-section-heading"><div><p>ข้อมูลสำหรับเตรียมข้อเสนอ</p><h2 id="company-bid-heading">ข้อมูลบริษัทสำหรับยื่นประมูล</h2></div></div>
        <div className="profile-fields">
            <label htmlFor="registration_number">เลขทะเบียนนิติบุคคล
                <input {...inputProps('registration_number')} maxLength={LIMITS.registration_number} value={profile.registration_number || ''} onChange={e => onChange('registration_number', e.target.value)} />
                {error('registration_number')}
            </label>
            <label htmlFor="authorized_signatory">ผู้มีอำนาจลงนาม
                <input {...inputProps('authorized_signatory')} maxLength={LIMITS.authorized_signatory} value={profile.authorized_signatory || ''} onChange={e => onChange('authorized_signatory', e.target.value)} />
                {error('authorized_signatory')}
            </label>
            <label htmlFor="address" className="profile-field-wide">ที่อยู่บริษัท
                <textarea {...inputProps('address')} maxLength={LIMITS.address} rows={3} value={profile.address || ''} onChange={e => onChange('address', e.target.value)} />
                {error('address')}
            </label>
        </div>
        <h3>ผลงานที่ผ่านมา ({projects.length}/{LIMITS.maxProjects})</h3>
        <p>ระบุปี พ.ศ. ข้อมูลนี้เป็นข้อมูลที่บริษัทระบุด้วยตนเอง</p>
        {error('past_projects')}
        {projects.map((project, i) => <fieldset className="profile-past-project" key={i} disabled={disabled}>
            <legend>ผลงานที่ {i + 1}</legend>
            {error(`past_projects.${i}`)}
            <div className="profile-fields">
                {['name', 'client', 'value', 'year'].map(field => {
                    const path = `past_projects.${i}.${field}`;
                    const label = { name: 'ชื่อโครงการ', client: 'ลูกค้า / หน่วยงาน', value: 'มูลค่าโครงการ (บาท)', year: 'ปีที่ดำเนินการ (พ.ศ.)' }[field];
                    const numeric = field === 'value' || field === 'year';
                    return <label key={field} htmlFor={path}>{label}
                        <input {...inputProps(path)} required type={numeric ? 'number' : 'text'} value={project[field] ?? ''}
                            min={numeric ? (field === 'year' ? LIMITS.minYear : 0) : undefined}
                            max={numeric ? (field === 'year' ? LIMITS.maxYear : LIMITS.maxMoney) : undefined}
                            step={field === 'year' ? 1 : field === 'value' ? 'any' : undefined}
                            maxLength={numeric ? undefined : LIMITS.projectText}
                            onChange={e => setProject(i, field, numeric && e.target.value !== '' ? Number(e.target.value) : e.target.value)} />
                        {error(path)}
                    </label>;
                })}
            </div>
            <button type="button" className="profile-project-button" onClick={() => onChange('past_projects', projects.filter((_, index) => index !== i))} aria-label={`ลบผลงานที่ ${i + 1}`}>ลบผลงานนี้</button>
        </fieldset>)}
        <button type="button" id="add-past-project" className="profile-project-button" disabled={disabled || projects.length >= LIMITS.maxProjects}
            onClick={() => onChange('past_projects', [...projects, { name: '', client: '', value: '', year: '' }])}>เพิ่มผลงานที่ผ่านมา</button>
    </section>;
}
