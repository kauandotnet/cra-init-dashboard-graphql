import React, { useMemo, useState, useEffect } from 'react';
import { Icon } from 'antd';
import moment from 'moment';
import client from '../../config/client';
import { sortNumber, sortString, sortBool } from '../../utils/general';
import SearchTableFilter from './SearchTableFilter';
import DateTableFilter from './DateTableFilter';

const typeSorter = {
  string: sortString,
  number: sortNumber,
  bool: sortBool,
};

const resolveRender = field => {
  if ((field.type === 'radio' || field.type === 'select') && !field.render) {
    field.render = (text, record) =>
      field.columnKey ? record[field.columnKey] : field.options[text];
  } else if (field.type === 'bool' && !field.render) {
    field.render = (text, record) =>
      record[field.key] ? field.options.true : field.options.false;
  }
  return field.render;
};

const FilterIcon = filtered => (
  <Icon
    type="search"
    style={{
      color: filtered ? 'white' : 'black',
      background: filtered ? '#1890ff' : undefined,
    }}
  />
);

const resolveFilter = field => {
  if (field.filter === true) {
    switch (field.type) {
      case 'date':
      case 'number':
      case 'select':
      case 'string': {
        return {
          filterDropdown:
            field.type === 'date' ? DateTableFilter : SearchTableFilter,
          filterIcon: FilterIcon,
          onFilter: (value, record) => {
            if (!record[field.columnKey || field.key]) {
              return false;
            }
            const valueForFilter =
              typeof record[field.columnKey || field.key] === 'object'
                ? record[field.columnKey || field.key].name
                : record[field.columnKey || field.key];
            return valueForFilter
              .toString()
              .toLowerCase()
              .includes(value.toLowerCase());
          },
        };
      }
      case 'radio': {
        const keysOptions = Object.keys(field.options);
        return {
          filters: keysOptions.map(value => ({
            value,
            text: field.options[value],
          })),
          filterMultiple: keysOptions.length > 2,
          onFilter: (value, record) => record[field.key].indexOf(value) === 0,
        };
      }
      case 'bool': {
        const keysOptions = Object.keys(field.options);
        return {
          filters: keysOptions.map(value => ({
            value,
            text: field.options[value],
          })),
          filterMultiple: false,
          onFilter: (value, record) => record[field.key].toString() === value,
        };
      }
      default: {
        return {};
      }
    }
  }
  return undefined;
};

const fieldsToColumns = fields =>
  fields
    .filter(
      field =>
        !(
          Object.hasOwnProperty.call(field, 'hidden') &&
          Object.hasOwnProperty.call(field, 'column')
        )
    )
    .map(field => ({
      title: field.title || '',
      key: field.key,
      dataIndex: field.key,
      sorter:
        field.sorter !== true
          ? false
          : typeSorter[field.type]
          ? typeSorter[field.type](field.key)
          : typeSorter.string(field.key),
      render: resolveRender(field),
      ...(field.columnStyle || {}),
      ...(resolveFilter(field) || {}),
    }));

const validateDependency = (
  field,
  allValues,
  keys = Object.keys(allValues)
) => {
  if (
    field.dependencies &&
    field.dependencies.fields.filter(dependency => keys.includes(dependency))
      .length > 0
  ) {
    if (
      (field.dependencies.fields || keys).reduce(
        (allHaveValues, current) => allHaveValues && !!allValues[current],
        true
      )
    ) {
      return field.dependencies && field.dependencies.onChange();
    }
  }
};

const setValueByType = (data, field) => {
  const fieldData =
    typeof data === 'object' && Object.hasOwnProperty.call(data, 'id')
      ? data.id
      : data;

  switch (field.type) {
    case 'date': {
      return moment(fieldData);
    }
    case 'number':
    case 'radio':
    case 'bool': {
      return fieldData;
    }
    default: {
      return fieldData.toString();
    }
  }
};

export function useCrudList(conf) {
  const [dataSource, setDataSource] = useState([]);
  const [loading, setLoading] = useState(false);
  const columns = useMemo(() => fieldsToColumns(conf.fields), [conf.fields]);

  useEffect(() => {
    setLoading(true);

    const subscribed = client
      .watchQuery({ query: conf.getList.query })
      .subscribe({
        next({ data: { users = [] } }) {
          setDataSource(users);
        },
      });

    client
      .query({ query: conf.getList.query })
      .then(response => {
        setLoading(false);
        setDataSource(response.data[conf.getList.accessData]);
      })
      .catch(e => {
        setLoading(false);
        console.log(e);
      });

    return () => subscribed._cleanup();
  }, [conf.getList]);

  const onDelete = key => {
    setLoading(true);
    client
      .mutate({
        mutation: conf.delete.query,
        variables: { [conf.keyName || 'id']: key },
        refetchQueries: [{ query: conf.getList.query }],
      })
      .then(response => {
        setLoading(false);
        if (
          response.data &&
          response.data[conf.getList.accessData] &&
          response.data[conf.getList.accessData].id > 0
        ) {
          setDataSource(
            dataSource.filter(
              d => d.id !== response.data[conf.getList.accessData].id
            )
          );
        }
      })
      .catch(e => {
        setLoading(false);
        console.log(e);
      });
  };

  return { columns, dataSource, onDelete, loading };
}

export function useCrudForm(conf, key) {
  const [loading, setLoading] = useState(false);
  const [fields, setFields] = useState(
    conf.fields.filter(
      field =>
        !(
          Object.hasOwnProperty.call(field, 'hidden') &&
          field.hidden.includes('form')
        )
    )
  );

  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        const valuesFields = {};
        const promises = { all: [], keys: {} };
        let i = 0;
        fields.forEach(field => {
          if (
            field.configOptions &&
            typeof field.configOptions.query === 'object'
          ) {
            const { query } = field.configOptions;
            promises.all.push(client.query({ query }));
            promises.keys[field.key] = i;
            i += 1;
          }
        });

        const responses = await Promise.all(promises.all);

        if (key) {
          const { data } = await client.query({
            query: conf.getByKey.query,
            variables: {
              [conf.keyName || 'id']: key,
            },
          });
          fields.forEach(field => {
            if (data[conf.getByKey.accessData][field.key]) {
              valuesFields[field.key] = {
                ...validateDependency(field, data[conf.getByKey.accessData]),
                value: setValueByType(
                  data[conf.getByKey.accessData][field.key],
                  field
                ),
              };
            }
          });
        }

        setFields(
          fields.map(field => {
            const options =
              promises.keys[field.key] >= 0
                ? (responses[promises.keys[field.key]] &&
                    responses[promises.keys[field.key]].data[
                      field.configOptions.accessData
                    ].reduce(
                      (items, item) => ({
                        ...items,
                        ...field.configOptions.map(item),
                      }),
                      {}
                    )) ||
                  {}
                : field.options || {};

            return {
              ...field,
              ...(valuesFields[field.key] || {}),
              options,
            };
          })
        );
      } catch (e) {
        console.log(e);
      }
      setLoading(false);
    }
    init();
    // eslint-disable-next-line
  }, [key]);

  const onSubmit = values => {
    setLoading(true);
    const isUpdating =
      key > 0
        ? {
            query: conf.getByKey.query,
            variables: { [conf.keyName || 'id']: key || undefined },
          }
        : undefined;

    client
      .mutate({
        mutation: conf.post.query,
        variables: { ...values, [conf.keyName || 'id']: key || undefined },
        refetchQueries: [{ query: conf.getList.query }, isUpdating].filter(
          Boolean
        ),
      })
      .then(response => {
        console.log('onSubmitHook', response);
        setLoading(false);
      })
      .catch(err => {
        setLoading(false);
        console.log(err);
      });
  };

  const onValuesChanged = (props, changedValues, allValues) => {
    const keys = Object.keys(changedValues);
    setFields(
      fields.map(field => ({
        ...field,
        ...validateDependency(field, allValues, keys),
        value: allValues[field.key],
      }))
    );
  };

  return { fields, onSubmit, loading, onValuesChanged };
}
