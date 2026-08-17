import csv
from io import TextIOWrapper


MAX_ROWS = 5000


def read_csv(file_obj):
    file_obj.seek(0)
    wrapper = TextIOWrapper(file_obj, encoding="utf-8-sig")
    reader = csv.reader(wrapper)
    rows = list(reader)
    if not rows:
        return [], []
    headers = [header.strip() for header in rows[0]]
    data_rows = rows[1 : MAX_ROWS + 1]
    return headers, data_rows


def to_row_dict(headers, row):
    return {headers[idx]: (row[idx].strip() if idx < len(row) else "") for idx in range(len(headers))}
