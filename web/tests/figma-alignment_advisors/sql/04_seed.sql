-- Test seed: the Figma's Nora Reyes scenario. Not the project's seed.
INSERT INTO universities (name, slug) VALUES ('UCF', 'ucf');

INSERT INTO terms (university_id, code, name, season, year)
SELECT u.id, v.code, v.name, v.season, v.year FROM universities u CROSS JOIN (VALUES
  ('fall-2025','Fall 2025','fall',2025),('spring-2026','Spring 2026','spring',2026),
  ('summer-2026','Summer 2026','summer',2026),('fall-2026','Fall 2026','fall',2026),
  ('spring-2027','Spring 2027','spring',2027),('summer-2027','Summer 2027','summer',2027),
  ('fall-2027','Fall 2027','fall',2027),('spring-2028','Spring 2028','spring',2028),
  ('fall-2028','Fall 2028','fall',2028),('spring-2029','Spring 2029','spring',2029)
) AS v(code,name,season,year);

INSERT INTO advisors (university_id, name, email, department, can_override)
SELECT u.id, v.n, v.e, 'CECS Advising', v.o FROM universities u CROSS JOIN (VALUES
  ('Dr. Avery Dunn','avery@ucf.edu',TRUE),('Marcus Okafor','marcus@ucf.edu',FALSE)) AS v(n,e,o);

INSERT INTO programs (university_id, name, degree_type, catalog_year, total_credits)
SELECT u.id, v.n, 'B.S.', 2026, 120 FROM universities u CROSS JOIN (VALUES
  ('Computer Science B.S.'),('Information Technology B.S.')) AS v(n);

-- courses
INSERT INTO courses (university_id, subject, number, title, credits, typically_offered)
SELECT u.id, v.s, v.n, v.t, v.c, v.o::text[] FROM universities u CROSS JOIN (VALUES
  ('COP','3223','Intro to C Programming',3,'{fall,spring}'),
  ('COT','3100','Discrete Structures I',3,'{fall,spring}'),
  ('MAC','2311','Calculus I',4,'{fall,spring}'),
  ('COP','3502','Computer Science I',3,'{fall,spring}'),
  ('COP','3330','OO Programming',3,'{fall,spring}'),
  ('CDA','3103','Computer Logic & Org.',3,'{fall,spring}'),
  ('MAC','2312','Calculus II',4,'{fall,spring}'),
  ('COP','3503','Computer Science II',3,'{fall,spring}'),
  ('COP','3402','Systems Software',3,'{fall,spring}'),
  ('STA','3032','Probability & Statistics',3,'{fall,spring}'),
  ('COP','4331','OO Software Development',3,'{fall,spring}'),
  ('COP','4600','Operating Systems',3,'{fall,spring}'),
  ('COT','4210','Discrete Structures II',3,'{fall,spring}'),
  ('CIS','3360','Security in Computing',3,'{fall,spring}'),
  ('CAP','4630','Artificial Intelligence',3,'{fall,spring}'),
  ('COP','4710','Database Systems',3,'{fall,spring}'),
  ('COP','4934','Senior Design I',3,'{fall,spring}'),
  ('COP','4935','Senior Design II',3,'{spring}'),
  ('CAP','4611','Algorithms for Machine Learning',3,'{fall,spring}'),
  ('COP','4020','Programming Languages',3,'{fall,spring}'),
  ('CNT','4714','Enterprise Computing',3,'{fall,spring}'),
  ('GEP','HUM1','Humanities (requirement slot)',3,'{fall,spring}')
) AS v(s,n,t,c,o);

-- prerequisites: "needs ONE from every group_no"
INSERT INTO prerequisites (course_id, required_course_id, kind, group_no)
SELECT c.id, r.id, 'prereq', v.g FROM (VALUES
  ('COP 3502','COP 3223',1),('COP 3330','COP 3223',1),('CDA 3103','COP 3223',1),('MAC 2312','MAC 2311',1),
  ('COP 3503','COP 3502',1),('COP 3503','COT 3100',2),
  ('COP 3402','COP 3502',1),('COP 3402','CDA 3103',2),
  ('STA 3032','MAC 2312',1),
  ('CIS 3360','COP 3502',1),('CIS 3360','CDA 3103',2),
  ('COT 4210','COT 3100',1),('COT 4210','COP 3502',2),
  ('COP 4331','COP 3503',1),('COP 4331','COP 3330',2),
  ('COP 4600','COP 3503',1),('COP 4600','COP 3402',2),
  ('CAP 4630','COP 3503',1),('COP 4710','COP 3503',1),
  ('COP 4934','COP 4331',1),('COP 4935','COP 4934',1),
  ('CAP 4611','COP 3503',1),('COP 4020','COP 3502',1)
) AS v(course, req, g)
JOIN courses c ON c.code = v.course JOIN courses r ON r.code = v.req;

-- CS requirements (CAP 4630 / 4611 / COP 4020 / CNT 4714 are "pick 1 restricted elective")
INSERT INTO program_requirements (program_id, course_id, category, group_label, pick_count, critical_path)
SELECT p.id, c.id, v.cat, v.grp, v.pick, v.crit FROM programs p CROSS JOIN (VALUES
  ('COP 3223','core',NULL,NULL,FALSE),('COT 3100','core',NULL,NULL,TRUE),('MAC 2311','math',NULL,NULL,FALSE),
  ('COP 3502','core',NULL,NULL,TRUE),('COP 3330','core',NULL,NULL,FALSE),('CDA 3103','core',NULL,NULL,FALSE),
  ('MAC 2312','math',NULL,NULL,FALSE),('COP 3503','core',NULL,NULL,TRUE),('COP 3402','core',NULL,NULL,FALSE),
  ('STA 3032','math',NULL,NULL,FALSE),('COP 4331','core',NULL,NULL,TRUE),('COP 4600','core',NULL,NULL,TRUE),
  ('COT 4210','core',NULL,NULL,FALSE),('CIS 3360','core',NULL,NULL,FALSE),('COP 4710','core',NULL,NULL,FALSE),
  ('COP 4934','core',NULL,NULL,TRUE),('COP 4935','core',NULL,NULL,TRUE),
  ('CAP 4630','elective','CS restricted elective',1,FALSE),('CAP 4611','elective','CS restricted elective',1,FALSE),
  ('COP 4020','elective','CS restricted elective',1,FALSE),('CNT 4714','elective','CS restricted elective',1,FALSE),
  ('GEP HUM1','gen_ed','Humanities',1,FALSE)
) AS v(code,cat,grp,pick,crit) JOIN courses c ON c.code = v.code
WHERE p.name = 'Computer Science B.S.';

-- students
INSERT INTO students (university_id, advisor_id, program_id, external_id, display_name, entry_term_id, expected_graduation_term_id, target_credits, work_hours_per_week)
SELECT u.id, (SELECT id FROM advisors WHERE name = v.adv), (SELECT id FROM programs WHERE name = v.prog), v.ext, v.name,
       (SELECT id FROM terms WHERE code = 'fall-2025'), (SELECT id FROM terms WHERE code = v.grad), v.target, v.work
FROM universities u CROSS JOIN (VALUES
  ('Dr. Avery Dunn','Computer Science B.S.','S1','Nora Reyes','spring-2029',12,0),
  ('Dr. Avery Dunn','Computer Science B.S.','S2','Priya Shah','spring-2029',15,25),
  ('Dr. Avery Dunn','Information Technology B.S.','S3','Marcus Bell','fall-2028',15,10),
  ('Dr. Avery Dunn','Computer Science B.S.','S4','Tyler Brooks','spring-2028',15,0),
  ('Marcus Okafor','Computer Science B.S.','S5','Elena Torres','fall-2028',15,0)
) AS v(adv,prog,ext,name,grad,target,work);

-- completed + in-progress (grade NULL = in progress)
INSERT INTO completed_courses (student_id, course_id, term_id, grade)
SELECT s.id, c.id, t.id, v.grade FROM (VALUES
  ('S1','COP 3223','fall-2025','A'),('S1','COT 3100','fall-2025','A-'),('S1','MAC 2311','fall-2025','B+'),
  ('S1','COP 3502','spring-2026','A-'),('S1','COP 3330','spring-2026','A'),('S1','CDA 3103','spring-2026','B'),('S1','MAC 2312','spring-2026','B+'),
  ('S1','COP 3503','fall-2026',NULL),('S1','COP 3402','fall-2026',NULL),('S1','STA 3032','fall-2026',NULL),
  ('S2','COP 3223','fall-2025','B'),('S2','COT 3100','fall-2025','C'),('S2','MAC 2311','fall-2025','W'),
  ('S2','COP 3502','spring-2026','C'),('S2','MAC 2311','spring-2026','F'),
  ('S3','COP 3223','fall-2025','B'),
  ('S5','COP 3223','fall-2025','A')
) AS v(ext,code,term,grade)
JOIN students s ON s.external_id = v.ext JOIN courses c ON c.code = v.code JOIN terms t ON t.code = v.term;

-- risk (0..1) with the factor shape the Databricks job writes
INSERT INTO student_risk_scores (student_id, course_id, risk_score, risk_level, factors, model_version)
SELECT s.id, NULL, v.score, v.lvl, v.factors::jsonb, 'weighted-v1' FROM (VALUES
  ('S1', 0.120, 'low',    '{"open_flags":{"raw":{"count":0},"score":0,"weight":0.3,"contribution":0},"pace_shortfall":{"raw":{"earned_credits":23,"expected_credits":24},"score":0.12,"weight":0.2,"contribution":0.12}}'),
  ('S2', 0.780, 'high',   '{"open_flags":{"raw":{"count":2,"severity_points":4},"score":1,"weight":0.3,"contribution":0.3},"non_passing":{"raw":{"unresolved_count":2},"score":1,"weight":0.25,"contribution":0.25},"pace_shortfall":{"raw":{"earned_credits":9,"expected_credits":30},"score":1,"weight":0.2,"contribution":0.2},"gpa_decline":{"raw":{},"score":0.3,"weight":0.1,"contribution":0.03},"retakes":{"raw":{"count":1},"score":0,"weight":0.1,"contribution":0}}'),
  ('S3', 0.740, 'high',   '{"open_flags":{"raw":{"count":3},"score":1,"weight":0.3,"contribution":0.3},"work_hours":{"raw":{"hours":10},"score":0.4,"weight":0.1,"contribution":0.04}}'),
  ('S5', 0.520, 'high',   '{"non_passing":{"raw":{"unresolved_count":1},"score":0.5,"weight":0.25,"contribution":0.125}}')
) AS v(ext,score,lvl,factors) JOIN students s ON s.external_id = v.ext;

INSERT INTO student_flags (student_id, flag_type, severity, message)
SELECT s.id, 'gpa_risk', 'high', 'GPA below 2.0' FROM students s WHERE s.external_id = 'S2';

-- spring 2027 schedule (fall 2027 has none: not published yet)
INSERT INTO sections (course_id, term_id, instructor_id, crn, section_code, modality, days, start_time, end_time, capacity, enrolled)
SELECT c.id, t.id, NULL, v.crn, v.sec, 'in-person', v.days::text[], v.st::time, v.en::time, v.cap, v.enr FROM (VALUES
  ('COP 4331','1001','001','{M,W}','10:00','11:15',40,20),
  ('COP 4600','1002','001','{T,R}','09:00','10:15',30,28),
  ('COT 4210','1003','001','{M,W}','13:00','14:15',40,10),
  ('CIS 3360','1004','001','{T,R}','13:00','14:15',40,30),
  ('CAP 4630','1005','001','{M,W}','15:00','16:15',35,20),
  ('COP 4710','1006','001','{T,R}','09:30','10:45',35,20),
  ('CAP 4611','1007','001','{F}','09:00','11:30',30,10),
  ('COP 4020','1008','001','{M,W}','08:00','09:15',30,10),
  ('CNT 4714','1009','001','{T,R}','15:00','16:15',30,10)
) AS v(code,crn,sec,days,st,en,cap,enr)
JOIN courses c ON c.code = v.code JOIN terms t ON t.code = 'spring-2027';

-- test stand-in for the course_demand view that was cut off in the pasted schema
CREATE OR REPLACE VIEW course_demand AS
SELECT s.term_id, c.id AS course_id, c.code, c.title,
       COALESCE(pd.n, 0)::int AS planned_students,
       COALESCE(SUM(s.capacity), 0)::int AS total_capacity,
       COALESCE(SUM(s.enrolled), 0)::int AS total_enrolled,
       GREATEST(COALESCE(pd.n, 0) - COALESCE(SUM(s.capacity - s.enrolled), 0), 0)::int AS seat_shortfall
FROM sections s JOIN courses c ON c.id = s.course_id
LEFT JOIN (SELECT pi.term_id, pi.course_id, COUNT(DISTINCT pl.student_id) AS n
           FROM plan_items pi JOIN plans pl ON pl.id = pi.plan_id AND pl.status <> 'archived'
           GROUP BY 1, 2) pd ON pd.term_id = s.term_id AND pd.course_id = c.id
GROUP BY s.term_id, c.id, c.code, c.title, pd.n;
