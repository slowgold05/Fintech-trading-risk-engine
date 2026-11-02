from sqlalchemy import Boolean, Column, MetaData, String, Table, create_engine

from app.scripts.migrate_mysql_to_postgres import _digest


def test_data_digest_is_independent_of_database_row_order():
    engines = [create_engine("sqlite://"), create_engine("sqlite://")]
    try:
        tables = []
        for engine, symbols in zip(engines, [("a", "B"), ("B", "a")]):
            table = Table("symbols", MetaData(), Column("symbol", String, primary_key=True),
                          Column("active", Boolean, nullable=False))
            table.create(engine)
            with engine.begin() as connection:
                connection.execute(table.insert(), [{"symbol": symbol, "active": True} for symbol in symbols])
            tables.append(table)
        with engines[0].connect() as first, engines[1].connect() as second:
            assert _digest(first, tables[0], tables[0].columns) == _digest(second, tables[1], tables[1].columns)
    finally:
        for engine in engines:
            engine.dispose()
